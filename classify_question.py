import json
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict

from gpt_client import GPT

capability_definitions = """
# Capability Definitions

## Spatial Reasoning
- Relative direction: Questions related to direction and relative positional relationships, such as up/down, left/right, front/back, far/near
- Relative distance: Judging the relative distance between objects, far or near
- Relative shape: Relative size, height, and other shapes, which object is larger, can A fit into B
- Multi-view matching: At least two perspective images of an object, matching the same object under view A and view B
- Dynamic: Dynamic spatial reasoning means the effect of egocentric and object motions on spatial relationships. For example, what movement did the object undergo? How should it move? What about speed and direction?

## Perception
- Object & Scene Recognition: Recognition of object and scene attributes
- Counting: Counting
- State & Activity Understanding: Current state and actions, such as what just happened? Robot gripper state, task success?

## Planning
- Goal Decomposition: Task decomposition, such as what to do next, what to do in the next N steps
- Navigation: Navigation, such as how to get from A to B?

## Prediction
- Trajectory: Trajectory prediction, which trajectory is most reasonable, what will happen after following trajectory A
- Future prediction: Predicting what will happen next, What will happen?
- What-if: Predicting the outcome of hypothetical actions, such as what will happen if the robot does action A

"""

question = "If the yellow robot gripper follows the yellow trajectory, what will happen? Choices: A. Robot puts the soda on the wooden steps. B. Robot moves the soda in front of the wooden steps. C. Robot moves the soda to the very top of the wooden steps. D. Robot picks up the soda can and moves it up."

prompt_template = f"""
You are given a taxonomy of visual reasoning capabilities and a question.
Your task is to determine which level-1 and level-2 capability the question best belongs to.

{capability_definitions}

Example Question: "{{question}}"

Return your answer strictly in the following JSON format:
{{{{
  "level-1": "<Selected Level-1 Capability>",
  "level-2": "<Selected Level-2 Capability>"
}}}}
"""



def classify_question(questions: Dict[str, str], max_workers: int = 8):
    model = GPT(
        model_name="openai/gpt-5",
        temperature=0.0,
        json_mode=True,
        api_key=os.getenv("FLAGEVAL_API_KEY"),
        url=os.getenv("FLAGEVAL_URL"),
    )
    
    def process_single_question(question_id: str, question: str):
        """Process a single question and return the result."""
        try:
            prompt = prompt_template.format(question=question)
            messages = model.build_message(query=prompt)
            response = model.infer(messages)
            response_json = json.loads(response)
            response_json["question"] = question
            if response_json["level-2"] == "Depth Estimation":
                response_json["level-2"] = "Depth estimation"
            if response_json["level-2"] == "Size Estimation":
                response_json["level-2"] = "Size estimation"
            return question_id, response_json
        except Exception as e:
            print(f"Error processing question {question_id}: {e}")
            return question_id, {"error": str(e), "question": question}
    
    results = {}
    
    # Use ThreadPoolExecutor for parallel processing
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Submit all tasks
        future_to_question = {
            executor.submit(process_single_question, question_id, question): question_id
            for question_id, question in questions.items()
        }
        
        # Collect results as they complete
        for future in as_completed(future_to_question):
            question_id = future_to_question[future]
            try:
                result_question_id, result_data = future.result()
                results[result_question_id] = result_data
                print(f"Completed processing question {result_question_id}")
            except Exception as e:
                print(f"Error getting result for question {question_id}: {e}")
                results[question_id] = {"error": str(e), "question": questions[question_id]}
    
    return results

if __name__ == "__main__":
    sample_questions = {
        "q1": "If the yellow robot gripper follows the yellow trajectory, what will happen? Choices: A. Robot puts the soda on the wooden steps. B. Robot moves the soda in front of the wooden steps. C. Robot moves the soda to the very top of the wooden steps. D. Robot picks up the soda can and moves it up.",
        "q2": "How many red blocks are stacked on top of each other in the image? Choices: A. 2 B. 3 C. 4 D. 5",
    }
    
    classification_results = classify_question(sample_questions, max_workers=2)
    for qid, result in classification_results.items():
        print(f"Question ID: {qid}, Classification: {result}")