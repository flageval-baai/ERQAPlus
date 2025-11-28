from typing import Dict, List, Tuple, Union
from collections import defaultdict
import re
from openai import OpenAI
import os
import json
import argparse
from typing import Optional
from utils import normalize_string, extract_answer, process_multiple_choice
from datasets import load_dataset, Dataset

def key_items_matching(pred: Dict, key_items: List[List[str]], remove_space=False) -> int:
    def process(x):
        if remove_space:
            x = x.replace(' ', '')
        return x.lower()
    # Check if any answer variant matches the prediction as a substring
    def match_any(pred_str, answer_variants):
        assert isinstance(answer_variants, list)
        return int(any(process(answer) in pred_str for answer in answer_variants))

    processed_pred = process(pred["answer"])
    if isinstance(key_items[0], list):
        return int(
            all(
                match_any(processed_pred, item_variants)
                for item_variants in key_items
            )
        )
    elif isinstance(key_items[0], str):
        return int(match_any(processed_pred, key_items))
    else:
        raise ValueError(f"Unsupported key_items type: {type(key_items[0])}")

def choices_matching(pred: Dict, label: str) -> int:
    pred["answer"] = process_multiple_choice(pred["answer"])
    pred_ans = pred["answer"]
    label = label.upper().replace(' ', '')
    if len(label) > 1:
        label = ''.join(sorted(set(label)))
        pred_ans = "".join(sorted(set(pred["answer"])))
    # elif len(pred["answer"]) > 1:
    #     pred["answer"] = pred["answer"][0]
    #     pred_ans = pred["answer"]
    return int(label == pred_ans)

    
def ordered_list_matching(pred: dict, order) -> int:    # Strict order list mating

    pred_ans = pred["answer"].lower().replace(" ", "").replace('*', '').replace('\'', '').strip(" `,")

    if isinstance(order[0], list):
        return int(any([pred_ans == ",".join(o).lower().replace(" ", "").strip(" `,") for o in order]))
    elif isinstance(order, list):
        order = ",".join(order)

    if "a-" in pred_ans:
        pred_ans = ','.join(re.findall("(?<=.-).",pred_ans))
    order = order.lower().replace(" ", "").strip(" `,*'")
    
    return int(pred_ans == order)


def bool_list_matching(pred:Dict, bool_str:list) -> int:
    pred_ans = pred['answer'].lower().replace(" ", "").replace('*', '').replace('\'', '').strip(" `,")
    if '[' in pred_ans:
        bool_str = '[' + ','.join(bool_str) + ']'
    else:
        bool_str = ','.join(bool_str)
    # print(bool_l, pred_ans)  # test
    return int(pred_ans == bool_str)



def number_matching(pred: Dict, value_to_match: Union[int, float]) -> int:  #multi-question form has been added
    # extract number from pred_ans
    matches = re.findall(r'-?\d+(?:\.\d+)?', pred["answer"])
    result = matches[-1] if matches else None
    if result is None:
        return 0
    pred_ans = float(result)  
    if isinstance(value_to_match, float):
        relative_error = abs(value_to_match) * 0.1
    else:
        relative_error = 1e-3
    return int(abs(pred_ans - value_to_match) < relative_error)


class Evaluator():
    def __init__(
        self,
        tracker_type,
        tracker_subtype=None,
        **kwargs,
    ):
        self.tracker_type = tracker_type
        self.tracker_subtype = tracker_subtype

    def get_score(self, gt: Dict, pred: Dict) -> Union[float, List[float]]:
        evaluator = gt["evaluator"]
        pred["raw_answer"] = pred["answer"]
        pred["answer"] = normalize_string(extract_answer(pred))
        registed_evaluator = set(["key_items_matching", "choices_matching", "ordered_list_matching", "bool_list_matching","number_matching", "location_matching", "interval_matching", "multi_interval_matching"])
        if evaluator not in registed_evaluator:
            raise ValueError(f"Unsupported evaluator: {evaluator}")
        return eval(evaluator)(pred, **gt["evaluator_kwargs"])

    def cal_accuracy(
        self, annotations: Dict, predictions: List[Dict], *args, **kwargs
    ) -> Dict:
        class ScoreTracker:
            def __init__(self):
                self.total_score = 0
                self.count = 0
                self.accuracy = 0
                self.subtypes = defaultdict(
                    lambda: [0, 0, 0]
                )  # [score_sum, count, accuracy]
            def update(self, score, sub_type):
                self.total_score += score
                self.count += 1
                self.subtypes[sub_type][0] += score
                self.subtypes[sub_type][1] += 1

        results = {}
        scores_by_type = defaultdict(ScoreTracker)
        for pred in predictions:
            question_id = str(pred["question_id"])
            gt = annotations[question_id]
            score = self.get_score(gt, pred)
            pred.update(gt)
            if pred.get('images'):
                del pred['images']
            pred["correct"] = score
            # Update scores
            bucket_key = pred.get(self.tracker_type) or gt.get(self.tracker_type) or "all"
            tracker = scores_by_type[bucket_key]
            if self.tracker_subtype is not None:
                sub_bucket_key = pred.get(self.tracker_subtype) or gt.get(self.tracker_subtype) or "all"
                tracker.update(score, sub_bucket_key)
            else:
                tracker.update(score, bucket_key)
        # Calculate accuracy
        for tracker in scores_by_type.values():
            tracker.accuracy = round(tracker.total_score / tracker.count, 3)
            for sub_type in tracker.subtypes:
                tracker.subtypes[sub_type][2] = round(
                    tracker.subtypes[sub_type][0] / tracker.subtypes[sub_type][1], 3
                )
        final_score = sum(tracker.total_score for tracker in scores_by_type.values())
        results["final_score"] = [final_score, len(predictions)]
        results["accuracy"] = round(final_score / len(predictions) * 100, 3)

        # Convert ScoreTracker objects to the expected format
        for qtype, tracker in scores_by_type.items():
            results[qtype] = [
                tracker.total_score,
                tracker.count,
                tracker.accuracy,
                dict(tracker.subtypes),
            ]

        return results


def _load_jsonl_or_json(path: str):
    with open(path, "r", encoding="utf-8") as f:
        text = f.read().strip()
        if not text:
            return []
        # Try JSON Lines
        if "\n" in text and text.split("\n")[0].strip().startswith("{") and not text.strip().startswith("["):
            return [json.loads(line) for line in text.splitlines() if line.strip()]
        return json.loads(text)


def _ensure_predictions_list(obj) -> List[Dict]:
    if isinstance(obj, list):
        return obj
    if isinstance(obj, dict):
        # Case 1: Single prediction object
        if "question_id" in obj and "answer" in obj:
            return [obj]
        # Case 2: Mapping from question_id -> prediction object
        if all(isinstance(v, dict) for v in obj.values()):
            out = []
            for qid, item in obj.items():
                merged = {"question_id": qid, **item}
                if "answer" not in merged:
                    raise ValueError(f"Prediction for question_id {qid} must include 'answer'.")
                out.append(merged)
            return out
        raise ValueError("Unsupported predictions dict format. Provide a single object with 'question_id'/'answer', a list of such objects, or a mapping from id to object.")
    raise ValueError("Unsupported predictions format; expected list or dict.")

def run_cli():
    parser = argparse.ArgumentParser(description="Simple, pluggable evaluator for various task types.")
    parser.add_argument("--predictions", required=True, help="Path to model predictions JSON/JSONL (list or dict keyed by question_id).")
    parser.add_argument("--tracker_type", default="all", help="Top-level bucket key; falls back to 'all' if missing.")
    parser.add_argument("--tracker_subtype", default="all", help="Optional sub-bucket key; falls back to 'all' if missing.")
    parser.add_argument("--output", default=None, help="Where to write aggregated metrics JSON. Default:scores.json")
    parser.add_argument("--updated", default=None)
    args = parser.parse_args()

    dataset = load_dataset("FlagEval/ERQAPlus", split='test')
    annotations = dataset
    if isinstance(annotations, list):
        # Expect list of objects with question_id
        annotations_dict = {}
        for item in annotations:
            qid = str(item.get("question_id"))
            if not qid:
                raise ValueError("Each annotation entry must contain question_id.")
            annotations_dict[qid] = item
        annotations = annotations_dict
    elif isinstance(annotations, Dataset):
        annotations_dict = {}
        for item in annotations:
            qid = str(item.get("question_id"))
            item["evaluator_kwargs"] = json.loads(item["evaluator_kwargs"])
            if not qid:
                raise ValueError("Each annotation entry must contain question_id.")
            annotations_dict[qid] = item
        annotations = annotations_dict
    else:
        raise ValueError("Unsupported data format.")

    predictions_raw = _load_jsonl_or_json(args.predictions)
    predictions = _ensure_predictions_list(predictions_raw)

    # Validate presence of required fields per question
    for p in predictions:
        qid = str(p.get("question_id"))
        if qid not in annotations:
            raise KeyError(f"Prediction question_id {qid} not found in annotations.")
        gt = annotations[qid]
        if "evaluator" not in gt or "evaluator_kwargs" not in gt:
            raise KeyError(f"Data for question_id {qid} must include 'evaluator' and 'evaluator_kwargs'.")
        if "answer" not in p:
            raise KeyError(f"Prediction for question_id {qid} must include 'answer'.")

    evaluator = Evaluator(
        tracker_type=args.tracker_type,
        tracker_subtype=args.tracker_subtype,
    )
    results = evaluator.cal_accuracy(annotations, predictions)

    output_path = args.output or (os.path.join(os.path.dirname(args.predictions), "scores.json"))
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    updated_pre_path = args.updated or os.path.join(os.path.dirname(args.predictions), "updated_predictions.json")
    with open(updated_pre_path, "w", encoding="utf-8") as f:
        json.dump(predictions, f, ensure_ascii=False, indent=2)
        
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    run_cli()
