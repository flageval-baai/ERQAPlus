import json
from pathlib import Path
from classify_question import classify_question

def is_chinese(text):
    """Check if the text contains Chinese characters"""
    for char in text:
        if '\u4e00' <= char <= '\u9fff':
            return True
    return False

def question_type_mapping(q_type):
    mapping = {
        '排序题': 'Sorting',
        '选择题': 'Multiple-choice',
        '组合判断题': 'Composite-judgement',
        '匹配题': 'Matching',
        '数值题': 'Counting',
        'multiple-choice':'Multiple-choice'
    }
    return mapping.get(q_type, q_type)

def question_subtype_mapping(q_stype):
    mapping = {
        '目标选择':'Target selection',
        '事件预测':'Event prediction',
        '多视角单帧':'Multi-view single-frame',
        '单视角多帧':'Single-view multi-frame',
        '数值估计':'Numerical estimation',
        '条件计数':'Conditional counting',
        '距离/深度':'Distance/Depth',
        '高度':'Height',
        '长度':'Length',
        '大小':'Size',
        '任务拆解':'Task decomposition',
        '动作顺序推理':'Action sequence reasoning',
        '顺序计数':'Sequential counting',
        '路径规划':'Path planning',
        '轨迹选择':'Trajectory selection',
        '轨迹预测':'Trajectory prediction',
    }
    return mapping.get(q_stype, q_stype)

def format_transform(anno: dict) -> dict:
    standard_anno = {}
    meta_data = anno['metadata']
    video_info = anno['videoAnnotations']
    #id
    standard_anno['question_id'] = Path((meta_data['username'] + '_' + meta_data['createdAt']).replace(':','-')).stem

    #question
    if meta_data['questionType'] == '选择题':
        choices = ''
        for i in range(len(meta_data['options'])):
            choices = choices+ chr(ord('A')+i) + '.' + meta_data['options'][i]+'\n'
        standard_anno['question'] = meta_data['question'] +'\n' + choices

    #question type
    standard_anno['question_type'] = question_type_mapping(meta_data['questionType'])
    standard_anno['question_subtype'] = question_subtype_mapping(meta_data['questionSubtype'])

    #reference answer
    if meta_data['questionType'] == '组合判断题':
        standard_anno['reference'] = '[' + ','.join([meta_data['answer'][i] for i in range(len(meta_data['answer']))]) + ']'
    else:
        standard_anno['reference'] = meta_data['answer']

    #image
    standard_anno['img_path'] = []
    for video in video_info.values():
        for item in video['annotations']:
            standard_anno['img_path'].append( 'img/' + standard_anno['question_id'] +'_'+ Path(item['imageFile']).name)

    #task category
    classify = classify_question({standard_anno['question_id']:standard_anno['question']})
    standard_anno['task_category'] = classify[standard_anno['question_id']]['level-1']
    standard_anno['task_sub_category'] = classify[standard_anno['question_id']]['level-2']

    #evaluator
    if meta_data['questionType'] == '排序题':
        standard_anno['evaluator'] = 'ordered_list_matching'
        if ';' in meta_data['answer']:      #Handle situations with multiple correct answers
            tmp = meta_data['answer'].split(';')
            standard_anno['evaluator_kwargs'] = {'order':[]}
            for o in tmp:
                standard_anno['evaluator_kwargs']['order'].append([i.strip() for i in o.split(',')])
        else:       #general situation
            standard_anno['evaluator_kwargs'] = {'order':[i.strip() for i in meta_data['answer'].split(',')]}

    elif meta_data['questionType'] == '选择题':
        standard_anno['evaluator'] = 'choices_matching'
        standard_anno['evaluator_kwargs'] = {'label':meta_data['answer']}

    elif meta_data['questionType'] == '组合判断题':
        standard_anno['evaluator'] = 'bool_list_matching'
        standard_anno['evaluator_kwargs'] = {'bool_str':[meta_data['answer'][i] for i in range(len(meta_data['answer']))]}

    elif meta_data['questionType'] == '匹配题':
        standard_anno['evaluator'] = 'ordered_list_matching'
        if ',' in meta_data['answer']:
            standard_anno['evaluator_kwargs'] = {'order':[i.strip() for i in meta_data['answer'].strip(' ,').split(',')]}
        else:
            standard_anno['evaluator_kwargs'] = {'order':[i.strip() for i in meta_data['answer']]}

    elif meta_data['questionType'] == '数值题':
        standard_anno['evaluator'] = 'number_matching'
        standard_anno['evaluator_kwargs'] = {'value_to_match':int(meta_data['answer'])}
    else:
        ValueError(f"Unsupported question type: {meta_data['questionType']}")

    #meta_info
    standard_anno['meta_info'] = {key:value for key,value in meta_data.items() if key not in ('question', 'questionType','questionSubtype','answer','jsonFile', 'options')}


    return standard_anno

def run():
    parser = argparse.ArgumentParser(description="Data formatting for ERQAPlus.")
    parser.add_argument("--input", required=True, help="Path to data annotate by annotation tool(general name for the 'annotation_summary.json').")
    parser.add_argument("--output", default=None, help="Where to write formatted data.")
    args = parser.parse_args()

    input_path = args.input
    output_path = args.output or (os.path.join(os.path.dirname(args.input), "formatted_data.json"))
    with open(input_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    if isinstance(data, list):
        formatted_data = []
        for item in data:
            formatted_data.append(format_transform(item))
    elif isinstance(data, dict):
        formatted_data = format_transform(data)

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(formatted_data, f, ensure_ascii=False, indent=4)

    return formatted_data

if __name__ == '__main__':
    run()
