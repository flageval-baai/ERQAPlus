// 在文件最开始添加 JSZip 的 CDN 引用
const script = document.createElement('script');
script.src = 'https://cdn.staticfile.org/jszip/3.10.1/jszip.min.js';
document.head.appendChild(script);

document.addEventListener('DOMContentLoaded', () => {
    // 获取所有需要的 DOM 元素
    const videoFileEl = document.getElementById('videoFile');
    const videoEl = document.getElementById('mainVideo');
    const annotationCanvasEl = document.getElementById('annotationCanvas');
    const ctx = annotationCanvasEl.getContext('2d');
    const videoContainer = document.querySelector('.video-container');
    const videoFileNameEl = document.getElementById('videoFileName');

    const playPauseBtn = document.getElementById('playPauseBtn');
    const seekBar = document.getElementById('seekBar');
    const penColorEl = document.getElementById('penColor');
    const penWidthEl = document.getElementById('penWidth');
    const clearCanvasBtn = document.getElementById('clearCanvasBtn');
    const questionTextEl = document.getElementById('questionText');
    const answerTextEl = document.getElementById('answerText');
    const saveAnnotationBtn = document.getElementById('saveAnnotationBtn');
    const mainCategorySelect = document.getElementById('mainCategory');
    const subCategorySelect = document.getElementById('subCategory');
    const usernameInput = document.getElementById('usernameInput');
    const saveUsernameBtn = document.getElementById('saveUsernameBtn');
    const toggleToolsBtn = document.getElementById('toggleToolsBtn');
    const toolsSection = document.querySelector('.tools-section');
    const startTipContainer = document.querySelector('.start-tip-container');
    const saveCurrentAnnotationBtn = document.getElementById('saveCurrentAnnotationBtn');
    const uploadVideoBtn = document.getElementById('uploadVideoBtn');

    const previewCanvasEl = document.getElementById('previewCanvas');
    const previewCtx = previewCanvasEl.getContext('2d');

    const optionsList = document.getElementById('optionsList');
    const addOptionBtn = document.getElementById('addOptionBtn');
    let options = [];

    const answerWrapper = document.getElementById('answerWrapper');

    // 状态变量
    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;
    let currentVideoName = 'video_annotation';
    let currentAnnotationId = null;
    let currentUsername = localStorage.getItem('annotation_username') || 'default_user';
    let annotationRecords = [];
    let isVideoLoaded = false;

    // 撤销功能相关
    const undoCanvasBtn = document.getElementById('undoCanvasBtn');
    let undoStack = [];

    // 分类数据
    const categories = {
        "Spatial Reasoning": [
            "Relative direction",
            "Relative distance",
            "Relative shape",
            "Multi-view matching",
            "Dynamic",
            "Abstract"
        ],
        "Perception": [
            "Object & Scene Recognition",
            "Visual Grounding",
            "Counting",
            "State & Activity Understanding"
        ],
        "Planing": [
            "Goal Decomposition",
            "Navigation"
        ],
        "Prediction": [    
            "Trajectory",
            "Future prediction"
        ],
        "Physical": [
            "Functional Reasoning",
            "World Knowledge"
        ]
    };

    // 工具选择相关
    let currentTool = 'pen';
    const toolBtns = [
        document.getElementById('toolPen'),
        document.getElementById('toolRect'),
        document.getElementById('toolArrow'),
        document.getElementById('toolText')
    ];
    toolBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            toolBtns.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            currentTool = btn.dataset.tool;
            // 切换工具时移除文字输入框
            if (previewTextInput) {
                previewTextInput.remove();
                previewTextInput = null;
            }
        });
    });
    // 默认选中画笔
    document.getElementById('toolPen').classList.add('selected');

    // 标注工具绘制逻辑
    let startX = 0, startY = 0;
    let previewing = false;
    let previewTextInput = null;

    function drawRectPreview(x, y) {
        previewCtx.clearRect(0, 0, previewCanvasEl.width, previewCanvasEl.height);
        previewCtx.save();
        previewCtx.strokeStyle = penColorEl.value;
        previewCtx.lineWidth = penWidthEl.value;
        previewCtx.setLineDash([6, 4]);
        previewCtx.strokeRect(startX, startY, x - startX, y - startY);
        previewCtx.restore();
    }
    function drawArrowPreview(x, y) {
        previewCtx.clearRect(0, 0, previewCanvasEl.width, previewCanvasEl.height);
        previewCtx.save();
        previewCtx.strokeStyle = penColorEl.value;
        previewCtx.lineWidth = penWidthEl.value;
        previewCtx.setLineDash([6, 4]);
        previewCtx.beginPath();
        previewCtx.moveTo(startX, startY);
        previewCtx.lineTo(x, y);
        previewCtx.stroke();
        const angle = Math.atan2(y - startY, x - startX);
        const len = 18 + Number(penWidthEl.value);
        previewCtx.beginPath();
        previewCtx.moveTo(x, y);
        previewCtx.lineTo(x - len * Math.cos(angle - Math.PI / 6), y - len * Math.sin(angle - Math.PI / 6));
        previewCtx.moveTo(x, y);
        previewCtx.lineTo(x - len * Math.cos(angle + Math.PI / 6), y - len * Math.sin(angle + Math.PI / 6));
        previewCtx.stroke();
        previewCtx.restore();
    }
    function drawTextAt(x, y, text) {
        pushUndo();
        ctx.save();
        ctx.font = `${16 + Number(penWidthEl.value) * 1.2}px sans-serif`;
        ctx.fillStyle = penColorEl.value;
        ctx.textBaseline = 'top';
        ctx.fillText(text, x, y);
        ctx.restore();
    }

    // 初始化分类选择
    function initCategories() {
        // 添加主分类选项
        Object.keys(categories).forEach(category => {
            const option = document.createElement('option');
            option.value = category;
            option.textContent = category;
            mainCategorySelect.appendChild(option);
        });
        updateSubCategories();
    }

    // 更新子分类选项
    function updateSubCategories() {
        subCategorySelect.innerHTML = '';
        const selectedMainCategory = mainCategorySelect.value;
        categories[selectedMainCategory].forEach(subCategory => {
            const option = document.createElement('option');
            option.value = subCategory;
            option.textContent = subCategory;
            subCategorySelect.appendChild(option);
        });
    }

    // 隐藏/显示工具区域
    if (toggleToolsBtn && toolsSection) {
        toggleToolsBtn.onclick = function() {
            toolsSection.classList.toggle('hidden');
            localStorage.setItem('tools_section_hidden', 
                toolsSection.classList.contains('hidden'));
        };

        // 从 localStorage 恢复状态
        const isHidden = localStorage.getItem('tools_section_hidden') === 'true';
        if (isHidden) {
            toolsSection.classList.add('hidden');
        }
    }

    // 保存用户名
    saveUsernameBtn.addEventListener('click', () => {
        const newUsername = usernameInput.value.trim();
        if (newUsername) {
            currentUsername = newUsername;
            localStorage.setItem('annotation_username', newUsername);
            alert('用户名已保存！');
        } else {
            alert('用户名不能为空！');
        }
    });

    // 监听输入框回车事件
    usernameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            saveUsernameBtn.click();
        }
    });

    // 关闭开始提示
    const closeTip = () => {
        startTipContainer.remove();
        document.removeEventListener('keydown', closeTip);
        document.removeEventListener('click', closeTip);
    };
    document.addEventListener('keydown', closeTip);
    document.addEventListener('click', closeTip);

    // 视频相关函数
    function getCurrentFrame() {
        return Math.floor(videoEl.currentTime * 30);
    }

    function getTotalFrames() {
        return Math.floor(videoEl.duration * 30);
    }

    function getTimeFromFrame(frame) {
        return frame / 30;
    }

    function setupSeekBar() {
        const totalFrames = getTotalFrames();
        const stepValue = (1 / totalFrames) * 100;
        seekBar.step = stepValue.toFixed(6);
    }

    // 画布相关函数
    function clearCanvas() {
        ctx.clearRect(0, 0, annotationCanvasEl.width, annotationCanvasEl.height);
    }

    function pushUndo() {
        // 保存当前主画布内容到undo栈
        undoStack.push(annotationCanvasEl.toDataURL());
        // 限制撤销栈最大长度
        if (undoStack.length > 30) undoStack.shift();
    }

    function undoCanvas() {
        if (undoStack.length === 0) return;
        const last = undoStack.pop();
        const img = new window.Image();
        img.onload = function() {
            ctx.clearRect(0, 0, annotationCanvasEl.width, annotationCanvasEl.height);
            ctx.drawImage(img, 0, 0);
        };
        img.src = last;
    }

    function draw(e) {
        if (!isVideoLoaded || !isDrawing || videoEl.paused === false) return;
        if (isDrawing) pushUndo();
        ctx.strokeStyle = penColorEl.value;
        ctx.lineWidth = penWidthEl.value;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const rect = annotationCanvasEl.getBoundingClientRect();
        const scaleX = annotationCanvasEl.width / rect.width;
        const scaleY = annotationCanvasEl.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(x, y);
        ctx.stroke();
        [lastX, lastY] = [x, y];
    }

    // 标注记录刷新
    function updateAnnotationRecords() {
        const container = document.querySelector('.annotation-records-container');
        while (container.children.length > 1) {
            container.removeChild(container.lastChild);
        }
        annotationRecords.forEach((record, index) => {
            const recordElement = document.createElement('div');
            recordElement.className = 'annotation-record-item';
            const recordContent = document.createElement('div');
            recordContent.innerHTML = `
                <div style="margin-bottom: 4px;"><strong>帧数：</strong>${record.videoFrame}</div>
                <div style="margin-bottom: 4px;"><strong>主分类：</strong>${record.mainCategory}</div>
                <div style="margin-bottom: 4px;"><strong>子分类：</strong>${record.subCategory}</div>
                <div style="margin-bottom: 4px;"><strong>问题：</strong>${record.question || '无'}</div>
                <div style="margin-bottom: 4px;"><strong>答案：</strong>${record.answer || '无'}</div>
                <img src="${record.imageData}" class="annotation-record-img">
            `;
            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = '删除';
            deleteBtn.className = 'annotation-record-delete annotation-btn annotation-btn-danger';
            deleteBtn.onclick = () => {
                annotationRecords.splice(index, 1);
                updateAnnotationRecords();
            };
            recordElement.appendChild(recordContent);
            recordElement.appendChild(deleteBtn);
            container.appendChild(recordElement);
        });
    }

    // 文件名显示
    function showVideoFileName(name) {
        videoFileNameEl.textContent = name ? `当前视频文件：${name}` : '';
    }

    // 帧数显示
    function updateTimeLine() {
        const currentFrameSpan = document.querySelector('.time-line-container span:first-child');
        const totalFramesSpan = document.querySelector('.time-line-container span:last-child');
        currentFrameSpan.textContent = `帧 ${getCurrentFrame()}`;
        totalFramesSpan.textContent = `总帧数 ${getTotalFrames()}`;
    }

    // 同步画布尺寸
    function syncCanvasSize() {
        annotationCanvasEl.width = videoEl.videoWidth;
        annotationCanvasEl.height = videoEl.videoHeight;
        previewCanvasEl.width = videoEl.videoWidth;
        previewCanvasEl.height = videoEl.videoHeight;
    }

    // 事件监听器
    mainCategorySelect.addEventListener('change', updateSubCategories);

    videoEl.addEventListener('loadedmetadata', () => {
        isVideoLoaded = true;
        syncCanvasSize();
        setupSeekBar();
    });

    videoEl.addEventListener('timeupdate', () => {
        const currentFrame = getCurrentFrame();
        const totalFrames = getTotalFrames();
        const percentage = (currentFrame / totalFrames) * 100;
        seekBar.value = percentage;
        updateTimeLine();
    });

    seekBar.addEventListener('input', () => {
        const totalFrames = getTotalFrames();
        const targetFrame = Math.round((seekBar.value / 100) * totalFrames);
        const clampedFrame = Math.max(0, Math.min(targetFrame, totalFrames - 1));
        const targetTime = getTimeFromFrame(clampedFrame);
        videoEl.currentTime = targetTime;
    });

    // 移除 videoContainer 的 click 事件，改为按钮点击上传
    uploadVideoBtn.addEventListener('click', () => {
        videoFileEl.click();
    });

    videoFileEl.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) {
            showVideoFileName(file.name);
            isVideoLoaded = false;
            const fileURL = URL.createObjectURL(file);
            
            const video = document.createElement('video');
            video.src = fileURL;
            
            video.addEventListener('error', (e) => {
                console.error('视频加载错误:', e);
                let errorMessage = '视频加载失败。';
                
                if (file.name.toLowerCase().endsWith('.mp4')) {
                    const codec = videoEl.canPlayType('video/mp4; codecs="av01.0.05M.08"');
                    if (!codec) {
                        errorMessage = '当前浏览器不支持 AV1 编码的 MP4 视频。请尝试使用 H.264 编码的视频文件。';
                    }
                }
                
                alert(errorMessage);
                URL.revokeObjectURL(fileURL);
                videoFileEl.value = '';
            });
            
            video.addEventListener('loadedmetadata', () => {
                const codec = videoEl.canPlayType('video/mp4; codecs="av01.0.05M.08"');
                if (!codec && file.name.toLowerCase().endsWith('.mp4')) {
                    alert('警告：当前浏览器可能不支持 AV1 编码的 MP4 视频。如果视频无法播放，请尝试使用 H.264 编码的视频文件。');
                }
                
                videoEl.src = fileURL;
                currentVideoName = file.name.replace(/\.[^/.]+$/, "");
                clearCanvas();
                questionTextEl.value = '';
                currentAnnotationId = null;
                
                videoFileEl.blur();
                document.querySelector('.video-container').focus();
            });
        }
    });

    playPauseBtn.addEventListener('click', () => {
        if (!isVideoLoaded) {
            console.log('请先加载视频！');
            return;
        }
        if (videoEl.paused || videoEl.ended) {
            videoEl.play();
            playPauseBtn.textContent = '暂停';
        } else {
            videoEl.pause();
            playPauseBtn.textContent = '播放';
        }
    });

    videoEl.addEventListener('play', () => playPauseBtn.textContent = '暂停');
    videoEl.addEventListener('pause', () => playPauseBtn.textContent = '播放');
    videoEl.addEventListener('ended', () => playPauseBtn.textContent = '播放');

    // 事件绑定
    annotationCanvasEl.addEventListener('mousedown', (e) => {
        if (!isVideoLoaded) {
            console.log('请先加载视频！');
            return;
        }
        if (videoEl.paused) {
            const rect = annotationCanvasEl.getBoundingClientRect();
            const scaleX = annotationCanvasEl.width / rect.width;
            const scaleY = annotationCanvasEl.height / rect.height;
            const x = (e.clientX - rect.left) * scaleX;
            const y = (e.clientY - rect.top) * scaleY;
            if (currentTool === 'pen') {
                isDrawing = true;
                lastX = x;
                lastY = y;
            } else if (currentTool === 'rect' || currentTool === 'arrow') {
                previewing = true;
                startX = x;
                startY = y;
                previewCtx.clearRect(0, 0, previewCanvasEl.width, previewCanvasEl.height);
            } else if (currentTool === 'text') {
                if (previewTextInput) previewTextInput.remove();
                previewTextInput = document.createElement('input');
                previewTextInput.type = 'text';
                previewTextInput.placeholder = '输入文字后回车';
                previewTextInput.style.position = 'absolute';
                previewTextInput.style.left = `${e.clientX}px`;
                previewTextInput.style.top = `${e.clientY}px`;
                previewTextInput.style.zIndex = 9999;
                previewTextInput.style.fontSize = '16px';
                previewTextInput.style.border = '1.5px solid #2196F3';
                previewTextInput.style.borderRadius = '4px';
                previewTextInput.style.padding = '2px 6px';
                document.body.appendChild(previewTextInput);
                previewTextInput.focus();
                previewTextInput.addEventListener('keydown', (evt) => {
                    if (evt.key === 'Enter') {
                        drawTextAt(x, y, previewTextInput.value);
                        previewTextInput.remove();
                        previewTextInput = null;
                    }
                });
            }
        } else {
            console.log('请先暂停视频再进行标注！');
        }
    });
    annotationCanvasEl.addEventListener('mousemove', (e) => {
        if (!isVideoLoaded || !videoEl.paused) return;
        const rect = annotationCanvasEl.getBoundingClientRect();
        const scaleX = annotationCanvasEl.width / rect.width;
        const scaleY = annotationCanvasEl.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        if (currentTool === 'pen' && isDrawing) {
            draw(e);
        } else if (currentTool === 'rect' && previewing) {
            drawRectPreview(x, y);
        } else if (currentTool === 'arrow' && previewing) {
            drawArrowPreview(x, y);
        } else if (previewing) {
            previewCtx.clearRect(0, 0, previewCanvasEl.width, previewCanvasEl.height);
        }
    });
    annotationCanvasEl.addEventListener('mouseup', (e) => {
        if (!isVideoLoaded || !videoEl.paused) return;
        const rect = annotationCanvasEl.getBoundingClientRect();
        const scaleX = annotationCanvasEl.width / rect.width;
        const scaleY = annotationCanvasEl.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        if (currentTool === 'pen') {
            isDrawing = false;
        } else if (currentTool === 'rect' && previewing) {
            pushUndo();
            ctx.save();
            ctx.strokeStyle = penColorEl.value;
            ctx.lineWidth = penWidthEl.value;
            ctx.setLineDash([]);
            ctx.strokeRect(startX, startY, x - startX, y - startY);
            ctx.restore();
            previewing = false;
            previewCtx.clearRect(0, 0, previewCanvasEl.width, previewCanvasEl.height);
        } else if (currentTool === 'arrow' && previewing) {
            pushUndo();
            ctx.save();
            ctx.strokeStyle = penColorEl.value;
            ctx.lineWidth = penWidthEl.value;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(x, y);
            ctx.stroke();
            const angle2 = Math.atan2(y - startY, x - startX);
            const len2 = 18 + Number(penWidthEl.value);
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x - len2 * Math.cos(angle2 - Math.PI / 6), y - len2 * Math.sin(angle2 - Math.PI / 6));
            ctx.moveTo(x, y);
            ctx.lineTo(x - len2 * Math.cos(angle2 + Math.PI / 6), y - len2 * Math.sin(angle2 + Math.PI / 6));
            ctx.stroke();
            ctx.restore();
            previewing = false;
            previewCtx.clearRect(0, 0, previewCanvasEl.width, previewCanvasEl.height);
        }
    });
    annotationCanvasEl.addEventListener('mouseout', () => {
        isDrawing = false;
        previewing = false;
        previewCtx.clearRect(0, 0, previewCanvasEl.width, previewCanvasEl.height);
    });

    clearCanvasBtn.addEventListener('click', clearCanvas);

    // 全局快捷键
    document.addEventListener('keydown', (e) => {
        const activeElement = document.activeElement;
        const isInput = activeElement.tagName === 'INPUT' || 
                       activeElement.tagName === 'TEXTAREA' ||
                       activeElement.isContentEditable;
        if (isInput) {
            return;
        }
        switch (e.key.toLowerCase()) {
            case ' ':
                if (!isVideoLoaded) {
                    console.log('请先加载视频！');
                    return;
                }
                e.preventDefault();
                if (videoEl.paused || videoEl.ended) {
                    videoEl.play();
                    playPauseBtn.textContent = '暂停';
                } else {
                    videoEl.pause();
                    playPauseBtn.textContent = '播放';
                }
                break;
            case 'c':
                e.preventDefault();
                if (!isVideoLoaded) {
                    console.log('请先加载视频！');
                    return;
                }
                clearCanvas();
                break;
            case 's':
                e.preventDefault();
                if (!isVideoLoaded) {
                    console.log('请先加载视频！');
                    return;
                }
                saveCurrentAnnotationBtn.click();
                break;
            case 'z':
                e.preventDefault();
                if (!isVideoLoaded) {
                    console.log('请先加载视频！');
                    return;
                }
                undoCanvas();
                break;
        }
    });

    // 校验选择题答案格式
    function isChoiceAnswerValid(answer, options) {
        // 允许单个字母或用英文逗号分隔的多个字母，且不超过选项数
        if (!answer) return false;
        const arr = answer.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
        if (arr.length === 0) return false;
        // 只能是A-Z，且不重复，且不超过选项数
        const validLetters = Array.from({length: options.length}, (_, i) => String.fromCharCode(65 + i));
        const set = new Set();
        for (const ch of arr) {
            if (!/^[A-Z]$/.test(ch)) return false;
            if (!validLetters.includes(ch)) return false;
            if (set.has(ch)) return false;
            set.add(ch);
        }
        return true;
    }

    // 保存当前标注时，保存选项或答案，并自动判断题目类型
    saveCurrentAnnotationBtn.addEventListener('click', () => {
        if (!isVideoLoaded) {
            alert('请先加载视频！');
            return;
        }
        if (!videoEl.paused) {
            alert('请先暂停视频再进行标注保存！');
            return;
        }
        // 合成视频帧和画布内容
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = annotationCanvasEl.width;
        tempCanvas.height = annotationCanvasEl.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(videoEl, 0, 0, tempCanvas.width, tempCanvas.height);
        tempCtx.drawImage(annotationCanvasEl, 0, 0);
        const imageData = tempCanvas.toDataURL('image/png');
        const videoFrame = Math.floor(videoEl.currentTime * 30);
        const mainCategory = mainCategorySelect.value;
        const subCategory = subCategorySelect.value;
        const question = questionTextEl.value.trim();
        const answer = answerTextEl.value.trim();
        let questionType = 'qa';
        let optionValues = undefined;
        if (options.length > 0) {
            questionType = 'choice';
            optionValues = options.slice();
            // 校验选择题答案
            if (!isChoiceAnswerValid(answer, optionValues)) {
                alert('选择题答案格式错误！请填写字母（如A或A,B），且只能选择已有选项。');
                return;
            }
        }
        annotationRecords.push({
            videoFrame,
            mainCategory,
            subCategory,
            question,
            answer,
            questionType,
            options: optionValues,
            imageData
        });
        updateAnnotationRecords();
        clearCanvas();
    });

    // 保存到本地按钮，保存成功后清空标注记录
    saveAnnotationBtn.addEventListener('click', async () => {
        if (!isVideoLoaded) {
            console.log("请先加载视频！");
            return;
        }
        if (annotationRecords.length === 0) {
            console.log("没有标注记录可保存！");
            return;
        }
        try {
            const zip = new JSZip();
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            currentAnnotationId = `${currentVideoName}_${timestamp}`;
            for (let i = 0; i < annotationRecords.length; i++) {
                const record = annotationRecords[i];
                const imageData = record.imageData.split(',')[1];
                zip.file(`${currentAnnotationId}_${i + 1}.png`, imageData, {base64: true});
            }
            // 取第一个标注的类型和选项（如有）
            let questionType = 'qa';
            let optionsTop = undefined;
            if (annotationRecords.length > 0) {
                if (annotationRecords[0].questionType === 'choice') {
                    questionType = 'choice';
                    optionsTop = annotationRecords[0].options;
                }
            }
            const annotationData = {
                id: currentAnnotationId,
                video_name: currentVideoName,
                timestamp: new Date().toISOString(),
                username: currentUsername,
                main_category: mainCategorySelect.value,
                sub_category: subCategorySelect.value,
                question: questionTextEl.value.trim(),
                answer: answerTextEl.value.trim(),
                questionType: questionType,
                options: optionsTop,
                records: annotationRecords.map((record, index) => ({
                    video_frame: record.videoFrame,
                    image_file: `${currentAnnotationId}_${index + 1}.png`
                }))
            };
            zip.file(`${currentAnnotationId}.json`, JSON.stringify(annotationData, null, 2));
            const zipBlob = await zip.generateAsync({type: 'blob'});
            const zipLink = document.createElement('a');
            zipLink.href = URL.createObjectURL(zipBlob);
            zipLink.download = `${currentAnnotationId}.zip`;
            document.body.appendChild(zipLink);
            zipLink.click();
            document.body.removeChild(zipLink);
            URL.revokeObjectURL(zipLink.href);
            annotationRecords = [];
            updateAnnotationRecords();
            clearCanvas();
            questionTextEl.value = '';
            answerTextEl.value = '';
            options = [];
            renderOptions();
            // 工具重置为画笔
            currentTool = 'pen';
            toolBtns.forEach(b => b.classList.remove('selected'));
            document.getElementById('toolPen').classList.add('selected');
            // 主/子类别重置为第一个
            if (mainCategorySelect.options.length > 0) mainCategorySelect.selectedIndex = 0;
            updateSubCategories();
            if (subCategorySelect.options.length > 0) subCategorySelect.selectedIndex = 0;
        } catch (error) {
            console.error('保存失败:', error);
        }
    });

    // 渲染选项
    function renderOptions() {
        optionsList.innerHTML = '';
        options.forEach((opt, idx) => {
            const label = String.fromCharCode(65 + idx); // A, B, C ...
            const div = document.createElement('div');
            div.style.display = 'flex';
            div.style.alignItems = 'center';
            div.style.marginBottom = '4px';
            const input = document.createElement('input');
            input.type = 'text';
            input.value = opt;
            input.placeholder = `选项${label}`;
            input.style.flex = '1';
            input.style.marginRight = '8px';
            input.addEventListener('input', e => {
                options[idx] = e.target.value;
            });
            const delBtn = document.createElement('button');
            delBtn.textContent = '删除';
            delBtn.className = 'annotation-btn annotation-btn-danger';
            delBtn.style.fontSize = '12px';
            delBtn.onclick = () => {
                options.splice(idx, 1);
                renderOptions();
                updateAnswerVisibility();
            };
            div.appendChild(document.createTextNode(label + '. '));
            div.appendChild(input);
            div.appendChild(delBtn);
            optionsList.appendChild(div);
        });
        updateAnswerVisibility();
    }

    // 添加选项
    addOptionBtn.addEventListener('click', () => {
        if (options.length >= 26) return;
        options.push('');
        renderOptions();
    });

    // 添加拖拽上传功能
    videoContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        videoContainer.classList.add('drag-over');
    });

    videoContainer.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        videoContainer.classList.remove('drag-over');
    });

    videoContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        videoContainer.classList.remove('drag-over');

        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('video/')) {
            showVideoFileName(file.name);
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            videoFileEl.files = dataTransfer.files;
            videoFileEl.dispatchEvent(new Event('change'));
        } else {
            alert('请上传视频文件！');
        }
    });

    // 初始化
    initCategories();
    videoEl.addEventListener('loadedmetadata', updateTimeLine);
    window.addEventListener('resize', syncCanvasSize);

    // 初始化用户名输入框
    usernameInput.value = localStorage.getItem('annotation_username') || '';

    if (undoCanvasBtn) {
        undoCanvasBtn.addEventListener('click', undoCanvas);
    }
});
