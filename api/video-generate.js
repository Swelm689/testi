// Vercel Serverless Function for Video-to-Video Generation using fal.ai Kling Video API
// This function handles video upload and submits the request to fal.ai

const { requireAuth } = require('../lib/_auth');

const FAL_API_KEY = process.env.FAL_API_KEY || process.env.FAL_KEY;

// Option definitions with types, values, and defaults for UI rendering
const OPTION_DEFS = {
    // Select options with specific values
    aspect_ratio: { type: 'select', values: ['16:9', '9:16', '1:1'], default: '16:9', label: 'Aspect Ratio' },
    resolution: { type: 'select', values: ['480p', '540p', '720p', '1080p'], default: '720p', label: 'Resolution' },
    duration: { type: 'select', values: ['5', '10'], default: '5', label: 'Duration (sec)' },
    duration_sora: { type: 'select', values: ['4', '8', '12'], default: '4', label: 'Duration (sec)' },
    duration_hailuo: { type: 'select', values: ['4', '6'], default: '4', label: 'Duration (sec)' },
    duration_grok: { type: 'select', values: ['6', '10', '15'], default: '6', label: 'Duration (sec)' },
    aspect_ratio_grok: { type: 'select', values: ['16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16'], default: '16:9', label: 'Aspect Ratio' },
    aspect_ratio_grok_i2v: { type: 'select', values: ['auto', '16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16'], default: 'auto', label: 'Aspect Ratio' },
    resolution_grok: { type: 'select', values: ['480p', '720p'], default: '720p', label: 'Resolution' },
    num_frames: { type: 'select', values: ['85', '129'], default: '129', label: 'Frames' },
    style: { type: 'select', values: ['realistic', 'anime', '3d_animation', 'clay', 'comic', 'cyberpunk'], default: 'realistic', label: 'Style' },
    effect: { type: 'select', values: ['hug', 'kiss', 'heart_gesture', 'squish'], default: 'hug', label: 'Effect' },
    thinking_type: { type: 'select', values: ['common', 'complex'], default: 'common', label: 'Thinking' },
    character_orientation: { type: 'select', values: ['left', 'right'], default: 'right', label: 'Character Facing' },
    video_quality: { type: 'select', values: ['low', 'medium', 'high'], default: 'high', label: 'Video Quality' },
    video_write_mode: { type: 'select', values: ['overwrite', 'append'], default: 'overwrite', label: 'Write Mode' },
    
    // Number inputs with constraints
    seed: { type: 'number', label: 'Seed' },
    cfg_scale: { type: 'select', values: ['0.3', '0.4', '0.5', '0.6', '0.7'], default: '0.5', label: 'CFG Scale' },
    guidance_scale: { type: 'select', values: ['5', '7.5', '10', '12.5', '15'], default: '7.5', label: 'Guidance' },
    num_inference_steps: { type: 'select', values: ['20', '30', '40', '50'], default: '30', label: 'Steps' },
    shift: { type: 'select', values: ['3', '5', '7', '9'], default: '5', label: 'Shift' },
    
    // Boolean options
    generate_audio: { type: 'bool', default: false, label: 'Generate Audio' },
    generate_audio_switch: { type: 'bool', default: false, label: 'Audio' },
    generate_multi_clip_switch: { type: 'bool', default: false, label: 'Multi-Clip' },
    camera_fixed: { type: 'bool', default: false, label: 'Fixed Camera' },
    enable_safety_checker: { type: 'bool', default: true, label: 'Safety Check' },
    enable_output_safety_checker: { type: 'bool', default: true, label: 'Output Safety' },
    enable_prompt_expansion: { type: 'bool', default: false, label: 'Expand Prompt' },
    pro_mode: { type: 'bool', default: false, label: 'Pro Mode' },
    prompt_optimizer: { type: 'bool', default: true, label: 'Optimize Prompt' },
    keep_audio: { type: 'bool', default: false, label: 'Keep Audio' },
    keep_original_sound: { type: 'bool', default: false, label: 'Keep Sound' },
    delete_video: { type: 'bool', default: true, label: 'Delete After' },
    multi_shots: { type: 'bool', default: false, label: 'Multi Shots' },
    use_turbo: { type: 'bool', default: false, label: 'Turbo Mode' },
    return_frames_zip: { type: 'bool', default: false, label: 'Return Frames ZIP' },
    
    // Text inputs
    negative_prompt: { type: 'text', label: 'Negative Prompt' },
    voice_ids: { type: 'text', label: 'Voice IDs (comma sep)' },
    audio_url: { type: 'text', label: 'Audio URL' },

    // Kling 3 specific options
    duration_kling3: { type: 'select', values: ['3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'], default: '5', label: 'Duration (3-15s)' },
    aspect_ratio_kling3: { type: 'select', values: ['16:9', '9:16', '1:1'], default: '16:9', label: 'Aspect Ratio' },
    aspect_ratio_o3_v2v: { type: 'select', values: ['auto', '16:9', '9:16', '1:1'], default: 'auto', label: 'Aspect Ratio' },
    shot_type_v3: { type: 'select', values: ['customize', 'intelligent'], default: 'customize', label: 'Shot Type' },
    shot_type_customize: { type: 'select', values: ['customize'], default: 'customize', label: 'Shot Type' },
};

const VIDEO_MODELS = {
    // Text to video
    'hunyuan-video': {
        label: 'Hunyuan Video (Text to Video)',
        endpoint: 'https://queue.fal.run/fal-ai/hunyuan-video',
        kind: 'text-to-video',
        allowedOptions: ['aspect_ratio', 'resolution', 'enable_safety_checker', 'num_inference_steps', 'seed', 'num_frames', 'pro_mode'],
    },
    'ltx-2-t2v-fast': {
        label: 'LTX Video 2.0 Fast (Text to Video)',
        endpoint: 'https://queue.fal.run/fal-ai/ltx-2/text-to-video/fast',
        kind: 'text-to-video',
    },
    'seedance-v1-lite-t2v': {
        label: 'Seedance 1.0 Lite (Text to Video)',
        endpoint: 'https://queue.fal.run/fal-ai/bytedance/seedance/v1/lite/text-to-video',
        kind: 'text-to-video',
    },
    'seedance-v1.5-pro-t2v': {
        label: 'Seedance 1.5 Pro (Text to Video + Audio)',
        endpoint: 'https://queue.fal.run/fal-ai/bytedance/seedance/v1.5/pro/text-to-video',
        kind: 'text-to-video',
        allowedOptions: ['aspect_ratio', 'resolution', 'duration', 'generate_audio', 'camera_fixed', 'seed'],
    },
    'sora-2-t2v': {
        label: 'Sora 2 Pro (Text to Video)',
        endpoint: 'https://queue.fal.run/fal-ai/sora-2/text-to-video/pro',
        kind: 'text-to-video',
        allowedOptions: ['aspect_ratio', 'resolution', 'duration_sora', 'delete_video'],
    },

    'kling-v2.6-pro-t2v': {
        label: 'Kling 2.6 Pro (Text to Video)',
        endpoint: 'https://queue.fal.run/fal-ai/kling-video/v2.6/pro/text-to-video',
        kind: 'text-to-video',
        allowedOptions: ['duration', 'aspect_ratio', 'negative_prompt', 'cfg_scale', 'generate_audio'],
    },
    'kling-v2.5-turbo-pro-t2v': {
        label: 'Kling 2.5 Turbo Pro (Text to Video)',
        endpoint: 'https://queue.fal.run/fal-ai/kling-video/v2.5-turbo/pro/text-to-video',
        kind: 'text-to-video',
        allowedOptions: ['duration', 'aspect_ratio', 'negative_prompt', 'cfg_scale'],
    },

    'wan-v2.6-t2v': {
        label: 'Wan v2.6 (Text to Video)',
        endpoint: 'https://queue.fal.run/wan/v2.6/text-to-video',
        kind: 'text-to-video',
        allowedOptions: ['aspect_ratio', 'resolution', 'duration', 'negative_prompt', 'enable_prompt_expansion', 'multi_shots', 'enable_safety_checker', 'seed', 'audio_url'],
    },

    'pixverse-v5-t2v': {
        label: 'PixVerse v5 (Text to Video)',
        endpoint: 'https://queue.fal.run/fal-ai/pixverse/v5/text-to-video',
        kind: 'text-to-video',
        allowedOptions: ['aspect_ratio', 'resolution', 'duration', 'negative_prompt', 'style', 'seed'],
    },
    'pixverse-v5.5-t2v': {
        label: 'PixVerse v5.5 (Text to Video + Audio + Multi-Clip)',
        endpoint: 'https://queue.fal.run/fal-ai/pixverse/v5.5/text-to-video',
        kind: 'text-to-video',
        allowedOptions: ['aspect_ratio', 'resolution', 'duration', 'negative_prompt', 'style', 'seed', 'generate_audio_switch', 'generate_multi_clip_switch', 'thinking_type'],
    },

    'hailuo-02-standard-t2v': {
        label: 'Hailuo-02 Standard (Text to Video)',
        endpoint: 'https://queue.fal.run/fal-ai/minimax/hailuo-02/standard/text-to-video',
        kind: 'text-to-video',
        allowedOptions: ['duration', 'prompt_optimizer'],
    },
    'hailuo-02-pro-t2v': {
        label: 'Hailuo-02 Pro (Text to Video)',
        endpoint: 'https://queue.fal.run/fal-ai/minimax/hailuo-02/pro/text-to-video',
        kind: 'text-to-video',
        allowedOptions: ['prompt_optimizer'],
    },

    // Grok Imagine Video (xAI)
    'grok-imagine-t2v': {
        label: 'Grok Imagine (Text to Video)',
        endpoint: 'https://queue.fal.run/xai/grok-imagine-video/text-to-video',
        kind: 'text-to-video',
        allowedOptions: ['duration_grok', 'aspect_ratio_grok', 'resolution_grok'],
    },

    // Image to video
    'kling-v2.1-standard-i2v': {
        label: 'Kling 2.1 Standard (Image to Video)',
        endpoint: 'https://queue.fal.run/fal-ai/kling-video/v2.1/standard/image-to-video',
        kind: 'image-to-video',
        allowedOptions: ['aspect_ratio', 'duration'],
    },
    'kling-o1-flfv-pro': {
        label: 'Kling O1 (First Frame → Last Frame) [Pro]',
        endpoint: 'https://queue.fal.run/fal-ai/kling-video/o1/image-to-video',
        kind: 'image-to-video',
        startImageParam: 'start_image_url',
        supportsEndImage: true,
        endImageParam: 'end_image_url',
        allowedOptions: ['duration'],
    },
    'kling-v2.6-pro-i2v': {
        label: 'Kling 2.6 Pro (Image to Video + Audio + Voice)',
        endpoint: 'https://queue.fal.run/fal-ai/kling-video/v2.6/pro/image-to-video',
        kind: 'image-to-video',
        allowedOptions: ['duration', 'negative_prompt', 'generate_audio', 'voice_ids'],
    },
    'kling-v2.5-turbo-pro-i2v': {
        label: 'Kling 2.5 Turbo Pro (Image to Video, Tail Frame)',
        endpoint: 'https://queue.fal.run/fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
        kind: 'image-to-video',
        supportsEndImage: true,
        endImageParam: 'tail_image_url',
        allowedOptions: ['duration', 'negative_prompt', 'cfg_scale'],
    },
    'veo2-i2v': {
        label: 'Veo 2 (Image to Video)',
        endpoint: 'https://queue.fal.run/fal-ai/veo2/image-to-video',
        kind: 'image-to-video',
    },
    'veo3.1-i2v': {
        label: 'Veo 3.1 (Image to Video)',
        endpoint: 'https://queue.fal.run/fal-ai/veo3.1/image-to-video',
        kind: 'image-to-video',
    },
    'sora-2-i2v': {
        label: 'Sora 2 Pro (Image to Video)',
        endpoint: 'https://queue.fal.run/fal-ai/sora-2/image-to-video/pro',
        kind: 'image-to-video',
        allowedOptions: ['aspect_ratio', 'resolution', 'duration_sora', 'delete_video'],
    },
    'wan-v2.6-i2v': {
        label: 'Wan v2.6 (Image to Video)',
        endpoint: 'https://queue.fal.run/wan/v2.6/image-to-video',
        kind: 'image-to-video',
        allowedOptions: ['resolution', 'duration', 'negative_prompt', 'enable_prompt_expansion', 'multi_shots', 'enable_safety_checker', 'seed', 'audio_url'],
    },
    'pixverse-v5-i2v': {
        label: 'PixVerse v5 (Image to Video)',
        endpoint: 'https://queue.fal.run/fal-ai/pixverse/v5/image-to-video',
        kind: 'image-to-video',
        allowedOptions: ['aspect_ratio', 'resolution', 'duration', 'negative_prompt', 'style', 'seed'],
    },
    'pixverse-v5.5-i2v': {
        label: 'PixVerse v5.5 (Image to Video + Audio + Multi-Clip)',
        endpoint: 'https://queue.fal.run/fal-ai/pixverse/v5.5/image-to-video',
        kind: 'image-to-video',
        allowedOptions: ['aspect_ratio', 'resolution', 'duration', 'negative_prompt', 'style', 'seed', 'generate_audio_switch', 'generate_multi_clip_switch', 'thinking_type'],
    },
    'pixverse-v5.5-effects': {
        label: 'PixVerse v5.5 Effects',
        endpoint: 'https://queue.fal.run/fal-ai/pixverse/v5.5/effects',
        kind: 'image-to-video',
        requiresPrompt: false,
        allowedOptions: ['effect', 'resolution', 'duration', 'negative_prompt', 'thinking_type'],
    },
    'lucy-14b-i2v': {
        label: 'Lucy-14B (Image to Video)',
        endpoint: 'https://queue.fal.run/decart/lucy-14b/image-to-video',
        kind: 'image-to-video',
        allowedOptions: ['resolution', 'aspect_ratio', 'sync_mode'],
    },
    'ltx-video-i2v': {
        label: 'LTX Video (Image to Video)',
        endpoint: 'https://queue.fal.run/fal-ai/ltx-video/image-to-video',
        kind: 'image-to-video',
        allowedOptions: ['negative_prompt', 'seed', 'num_inference_steps', 'guidance_scale'],
    },
    'framepack-i2v': {
        label: 'Framepack (Image to Video)',
        endpoint: 'https://queue.fal.run/fal-ai/framepack',
        kind: 'image-to-video',
    },
    'pixverse-v3.5-i2v': {
        label: 'PixVerse v3.5 (Image to Video)',
        endpoint: 'https://queue.fal.run/fal-ai/pixverse/v3.5/image-to-video',
        kind: 'image-to-video',
    },
    'seedance-v1-lite-i2v': {
        label: 'Seedance 1.0 Lite (Image to Video)',
        endpoint: 'https://queue.fal.run/fal-ai/bytedance/seedance/v1/lite/image-to-video',
        kind: 'image-to-video',
    },
    'seedance-v1.5-pro-i2v': {
        label: 'Seedance 1.5 Pro (Image to Video + Audio, End Frame)',
        endpoint: 'https://queue.fal.run/fal-ai/bytedance/seedance/v1.5/pro/image-to-video',
        kind: 'image-to-video',
        supportsEndImage: true,
        allowedOptions: ['aspect_ratio', 'resolution', 'duration', 'generate_audio', 'camera_fixed', 'seed'],
    },
    'hailuo-02-standard-i2v': {
        label: 'Hailuo-02 Standard (Image to Video, End Frame)',
        endpoint: 'https://queue.fal.run/fal-ai/minimax/hailuo-02/standard/image-to-video',
        kind: 'image-to-video',
        supportsEndImage: true,
        endImageParam: 'end_image_url',
        allowedOptions: ['duration', 'resolution', 'prompt_optimizer'],
    },
    'hailuo-02-pro-i2v': {
        label: 'Hailuo-02 Pro (Image to Video, End Frame)',
        endpoint: 'https://queue.fal.run/fal-ai/minimax/hailuo-02/pro/image-to-video',
        kind: 'image-to-video',
        supportsEndImage: true,
        endImageParam: 'end_image_url',
        allowedOptions: ['prompt_optimizer'],
    },
    'hailuo-2.3-pro-i2v': {
        label: 'Hailuo 2.3 Pro (Image to Video)',
        endpoint: 'https://queue.fal.run/fal-ai/minimax/hailuo-2.3/pro/image-to-video',
        kind: 'image-to-video',
        allowedOptions: ['prompt_optimizer'],
    },
    'hailuo-2.3-pro-t2v': {
        label: 'Hailuo 2.3 Pro (Text to Video)',
        endpoint: 'https://queue.fal.run/fal-ai/minimax/hailuo-2.3/pro/text-to-video',
        kind: 'text-to-video',
        allowedOptions: ['prompt_optimizer'],
    },
    'hailuo-2.3-standard-t2v': {
        label: 'Hailuo 2.3 Standard (Text to Video)',
        endpoint: 'https://queue.fal.run/fal-ai/minimax/hailuo-2.3/standard/text-to-video',
        kind: 'text-to-video',
        allowedOptions: ['duration', 'prompt_optimizer'],
    },
    'hailuo-2.3-standard-i2v': {
        label: 'Hailuo 2.3 Standard (Image to Video)',
        endpoint: 'https://queue.fal.run/fal-ai/minimax/hailuo-2.3/standard/image-to-video',
        kind: 'image-to-video',
        allowedOptions: ['duration', 'prompt_optimizer'],
    },

    // Grok Imagine Video (xAI) - Image to Video
    'grok-imagine-i2v': {
        label: 'Grok Imagine (Image to Video)',
        endpoint: 'https://queue.fal.run/xai/grok-imagine-video/image-to-video',
        kind: 'image-to-video',
        allowedOptions: ['duration_grok', 'aspect_ratio_grok_i2v', 'resolution_grok'],
    },

    // Video to video
    'kling-o1-v2v-reference': {
        label: 'Kling O1 (Video to Video - Reference)',
        endpoint: 'https://queue.fal.run/fal-ai/kling-video/o1/video-to-video/reference',
        kind: 'video-to-video',
        allowedOptions: ['aspect_ratio', 'duration', 'keep_audio'],
    },
    'kling-o1-v2v-edit': {
        label: 'Kling O1 (Video to Video - Edit) [Pro]',
        endpoint: 'https://queue.fal.run/fal-ai/kling-video/o1/video-to-video/edit',
        kind: 'video-to-video',
        allowedOptions: ['keep_audio'],
    },
    'kling-v2.6-pro-motion-control': {
        label: 'Kling 2.6 Pro (Motion Control: Image + Video → Video)',
        endpoint: 'https://queue.fal.run/fal-ai/kling-video/v2.6/pro/motion-control',
        kind: 'motion-control',
        requiresPrompt: false,
        usesImageUrls: false,
        allowedOptions: ['character_orientation', 'keep_original_sound'],
    },
    'wan-v2.2-14b-animate-move': {
        label: 'Wan 2.2 14B Animate Move (Image + Video → Video)',
        endpoint: 'https://queue.fal.run/fal-ai/wan/v2.2-14b/animate/move',
        kind: 'motion-control',
        requiresPrompt: false,
        usesImageUrls: false,
        optionTypes: {
            guidance_scale: 'number',
            num_inference_steps: 'number',
            seed: 'number',
            shift: 'number',
        },
        allowedOptions: [
            'guidance_scale',
            'resolution',
            'seed',
            'num_inference_steps',
            'enable_safety_checker',
            'enable_output_safety_checker',
            'shift',
            'video_quality',
            'video_write_mode',
            'return_frames_zip',
            'use_turbo',
        ],
    },
    'wan-v2.2-a14b-v2v': {
        label: 'Wan 2.2 A14B (Video to Video)',
        endpoint: 'https://queue.fal.run/wan/v2.2-a14b/video-to-video',
        kind: 'video-to-video',
    },
    'animatediff-v2v': {
        label: 'AnimateDiff (Video to Video)',
        endpoint: 'https://queue.fal.run/fal-ai/fast-animatediff/video-to-video',
        kind: 'video-to-video',
    },
    'sora-2-v2v-remix': {
        label: 'Sora 2 (Video to Video - Remix)',
        endpoint: 'https://queue.fal.run/fal-ai/sora-2/video-to-video/remix',
        kind: 'video-id-to-video',
        allowedOptions: ['delete_video'],
    },

    // Reference to video (multi-reference image conditioning)
    'kling-o1-reference-to-video': {
        label: 'Kling O1 (Reference to Video)',
        endpoint: 'https://queue.fal.run/fal-ai/kling-video/o1/reference-to-video',
        kind: 'reference-to-video',
        allowedOptions: ['aspect_ratio', 'duration'],
    },
    'veo3.1-reference-to-video': {
        label: 'Veo 3.1 (Reference to Video)',
        endpoint: 'https://queue.fal.run/fal-ai/veo3.1/reference-to-video',
        kind: 'reference-to-video',
        allowedOptions: ['duration', 'resolution', 'generate_audio', 'auto_fix'],
    },

    // ==================== KLING 3 MODELS ====================
    // Kling 3.0 Pro (v3) - Text to Video
    'kling-v3-pro-t2v': {
        label: 'Kling 3.0 Pro (Text to Video)',
        endpoint: 'https://queue.fal.run/fal-ai/kling-video/v3/pro/text-to-video',
        kind: 'kling3-text-to-video',
        requiresPrompt: true,
        requiresImage: false,
        supportsMultiPrompt: true,
        allowedOptions: ['duration_kling3', 'aspect_ratio_kling3', 'shot_type_v3', 'cfg_scale', 'negative_prompt', 'generate_audio', 'voice_ids'],
    },
    // Kling 3.0 Pro (v3) - Image to Video
    'kling-v3-pro-i2v': {
        label: 'Kling 3.0 Pro (Image to Video)',
        endpoint: 'https://queue.fal.run/fal-ai/kling-video/v3/pro/image-to-video',
        kind: 'kling3-image-to-video',
        requiresPrompt: false,
        requiresImage: true,
        startImageParam: 'start_image_url',
        supportsEndImage: true,
        endImageParam: 'end_image_url',
        supportsMultiPrompt: true,
        supportsElements: true,
        allowedOptions: ['duration_kling3', 'aspect_ratio_kling3', 'shot_type_customize', 'cfg_scale', 'negative_prompt', 'generate_audio', 'voice_ids'],
    },

    // Kling O3 Pro - Text to Video
    'kling-o3-pro-t2v': {
        label: 'Kling O3 Pro (Text to Video)',
        endpoint: 'https://queue.fal.run/fal-ai/kling-video/o3/pro/text-to-video',
        kind: 'kling3-text-to-video',
        requiresPrompt: true,
        requiresImage: false,
        supportsMultiPrompt: true,
        allowedOptions: ['duration_kling3', 'aspect_ratio_kling3', 'shot_type_customize', 'generate_audio', 'voice_ids'],
    },
    // Kling O3 Pro - Image to Video
    'kling-o3-pro-i2v': {
        label: 'Kling O3 Pro (Image to Video)',
        endpoint: 'https://queue.fal.run/fal-ai/kling-video/o3/pro/image-to-video',
        kind: 'kling3-image-to-video',
        requiresPrompt: false,
        requiresImage: true,
        startImageParam: 'image_url',
        supportsEndImage: true,
        endImageParam: 'end_image_url',
        supportsMultiPrompt: true,
        allowedOptions: ['duration_kling3', 'shot_type_customize', 'generate_audio'],
    },
    // Kling O3 Pro - Reference to Video
    'kling-o3-pro-ref2v': {
        label: 'Kling O3 Pro (Reference to Video)',
        endpoint: 'https://queue.fal.run/fal-ai/kling-video/o3/pro/reference-to-video',
        kind: 'kling3-reference-to-video',
        requiresPrompt: true,
        requiresImage: true,
        startImageParam: 'image_url',
        supportsEndImage: true,
        endImageParam: 'end_image_url',
        supportsElements: true,
        allowedOptions: ['duration_kling3', 'aspect_ratio_kling3', 'shot_type_customize', 'generate_audio'],
    },
    // Kling O3 Pro - Video to Video Edit
    'kling-o3-pro-v2v-edit': {
        label: 'Kling O3 Pro (V2V Edit)',
        endpoint: 'https://queue.fal.run/fal-ai/kling-video/o3/pro/video-to-video/edit',
        kind: 'kling3-video-to-video',
        requiresPrompt: true,
        requiresImage: false,
        supportsElements: true,
        allowedOptions: ['keep_audio', 'shot_type_customize'],
    },
    // Kling O3 Pro - Video to Video Reference
    'kling-o3-pro-v2v-ref': {
        label: 'Kling O3 Pro (V2V Reference)',
        endpoint: 'https://queue.fal.run/fal-ai/kling-video/o3/pro/video-to-video/reference',
        kind: 'kling3-video-to-video',
        requiresPrompt: true,
        requiresImage: false,
        supportsElements: true,
        allowedOptions: ['duration_kling3', 'aspect_ratio_o3_v2v', 'shot_type_customize', 'keep_audio'],
    },
};

const config = {
    api: {
        bodyParser: false, // Disable default body parsing for file uploads
    },
};

async function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk) => {
            body += chunk;
        });
        req.on('end', () => {
            if (!body) return resolve({});
            try {
                resolve(JSON.parse(body));
            } catch (e) {
                reject(e);
            }
        });
        req.on('error', reject);
    });
}

// Helper to parse multipart form data
async function parseFormData(req) {
    const busboy = require('busboy');

    return new Promise((resolve, reject) => {
        const fields = {};
        let videoFile = null;
        let endImageFile = null;
        const imageFiles = [];

        const bb = busboy({ headers: req.headers });

        bb.on('file', (name, file, info) => {
            const { filename, mimeType } = info;
            const chunks = [];

            file.on('data', (data) => {
                chunks.push(data);
            });

            file.on('end', () => {
                const buffer = Buffer.concat(chunks);
                if (!buffer || buffer.length === 0) return;

                if (name === 'video') {
                    videoFile = {
                        buffer,
                        filename,
                        mimeType,
                    };
                    return;
                }

                if (name === 'end_image' || name === 'endImage') {
                    endImageFile = {
                        buffer,
                        filename,
                        mimeType,
                    };
                    return;
                }

                if (name === 'image' || name === 'images') {
                    imageFiles.push({
                        buffer,
                        filename,
                        mimeType,
                    });
                }
            });
        });

        bb.on('field', (name, val) => {
            fields[name] = val;
        });

        bb.on('close', () => {
            resolve({
                fields,
                videoFile,
                endImageFile,
                imageFiles,
            });
        });

        bb.on('error', reject);

        req.pipe(bb);
    });
}

// Upload file to fal.ai storage
async function uploadToFal(fileBuffer, fileName, mimeType) {
    const FormData = require('form-data');
    const form = new FormData();

    form.append('file', fileBuffer, {
        filename: fileName,
        contentType: mimeType
    });

    const response = await fetch('https://fal.run/fal-ai/storage/upload', {
        method: 'POST',
        headers: {
            'Authorization': `Key ${FAL_API_KEY}`,
        },
        body: form
    });

    if (!response.ok) {
        throw new Error(`Failed to upload file: ${response.statusText}`);
    }

    const data = await response.json();
    return data.url;
}

module.exports = async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (!requireAuth(req, res)) {
        return;
    }

    // GET = return models list (was video-models.js)
    if (req.method === 'GET') {
        try {
            const models = Object.entries(VIDEO_MODELS).map(([id, m]) => ({
                id,
                label: m && m.label ? m.label : id,
                kind: m && m.kind ? m.kind : null,
                allowedOptions: Array.isArray(m && m.allowedOptions) ? m.allowedOptions : [],
                optionTypes: (m && m.optionTypes && typeof m.optionTypes === 'object') ? m.optionTypes : null,
                requiresPrompt: (m && Object.prototype.hasOwnProperty.call(m, 'requiresPrompt')) ? m.requiresPrompt : true,
                requiresImage: (m && Object.prototype.hasOwnProperty.call(m, 'requiresImage')) ? m.requiresImage : true,
                usesImageUrls: (m && Object.prototype.hasOwnProperty.call(m, 'usesImageUrls')) ? m.usesImageUrls : true,
                supportsEndImage: !!(m && m.supportsEndImage),
                startImageParam: m && m.startImageParam ? m.startImageParam : null,
                endImageParam: m && m.endImageParam ? m.endImageParam : null,
            }));
            models.sort((a, b) => String(a.label).localeCompare(String(b.label)));
            return res.status(200).json({ models, optionDefs: OPTION_DEFS });
        } catch (e) {
            return res.status(500).json({ error: e && e.message ? e.message : 'Internal server error' });
        }
    }

    // Only allow POST for generation
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Check for API key
    if (!FAL_API_KEY) {
        return res.status(500).json({ error: 'FAL_KEY environment variable not configured' });
    }

    try {
        const contentType = (req.headers['content-type'] || '').toLowerCase();

        let model_id;
        let prompt;
        let multi_prompt;
        let duration;
        let aspect_ratio;
        let keep_audio;
        let video_id;
        let video_url;
        let image_url;
        let start_image_url;
        let end_image_url;
        let tail_image_url;
        let image_urls;
        let elements;
        let videoFile;
        let endImageFile;
        let imageFiles;
        let options;

        if (contentType.includes('application/json')) {
            const body = await readJsonBody(req);
            model_id = body.model_id;
            prompt = body.prompt;
            multi_prompt = body.multi_prompt;
            duration = body.duration;
            aspect_ratio = body.aspect_ratio;
            keep_audio = body.keep_audio;
            video_id = body.video_id;
            video_url = body.video_url;
            image_url = body.image_url;
            start_image_url = body.start_image_url;
            end_image_url = body.end_image_url;
            tail_image_url = body.tail_image_url;
            image_urls = body.image_urls;
            elements = body.elements;
            options = body.options;
            // Handle audio_url from body
            if (body.audio_url) {
                if (!options) options = {};
                options.audio_url = body.audio_url;
            }
            videoFile = null;
            endImageFile = null;
            imageFiles = [];
        } else {
            const parsed = await parseFormData(req);
            const fields = parsed.fields || {};
            videoFile = parsed.videoFile;
            endImageFile = parsed.endImageFile;
            imageFiles = parsed.imageFiles || [];

            model_id = fields.model_id;
            prompt = fields.prompt;
            duration = fields.duration;
            aspect_ratio = fields.aspect_ratio;
            keep_audio = fields.keep_audio;
            video_id = fields.video_id;
            video_url = fields.video_url;
            image_url = fields.image_url;
            start_image_url = fields.start_image_url;
            end_image_url = fields.end_image_url;
            tail_image_url = fields.tail_image_url;

            if (fields.image_urls) {
                try {
                    image_urls = JSON.parse(fields.image_urls);
                } catch {
                    image_urls = null;
                }
            }

            if (fields.elements) {
                try {
                    elements = JSON.parse(fields.elements);
                } catch {
                    elements = null;
                }
            }

            if (fields.options) {
                try {
                    options = JSON.parse(fields.options);
                } catch {
                    options = null;
                }
            }
        }

        const selectedModel = VIDEO_MODELS[model_id] || VIDEO_MODELS['kling-o1-v2v-reference'];

        if (!selectedModel) {
            return res.status(400).json({ error: 'Unknown model_id' });
        }

        // For Kling 3 models, either prompt or multi_prompt is required
        const isKling3Model = selectedModel.kind && selectedModel.kind.startsWith('kling3-');
        if (isKling3Model) {
            if (!prompt && !multi_prompt) {
                return res.status(400).json({ error: 'Either prompt or multi_prompt is required' });
            }
            if (prompt && multi_prompt) {
                return res.status(400).json({ error: 'Cannot use both prompt and multi_prompt - choose one' });
            }
        } else if (selectedModel.requiresPrompt !== false && !prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        if (!image_url && start_image_url) {
            image_url = start_image_url;
        }

        let finalVideoUrl = null;
        let finalImageUrl = null;

        if (selectedModel.kind === 'video-to-video' || selectedModel.kind === 'motion-control' || selectedModel.kind === 'kling3-video-to-video') {
            finalVideoUrl = video_url || null;
            if (!finalVideoUrl && videoFile) {
                finalVideoUrl = await uploadToFal(videoFile.buffer, videoFile.filename, videoFile.mimeType);
            }
            if (!finalVideoUrl) {
                return res.status(400).json({ error: 'video_url or video file is required for this model' });
            }
        }

        if (selectedModel.kind === 'image-to-video' || selectedModel.kind === 'motion-control' || selectedModel.kind === 'kling3-image-to-video' || selectedModel.kind === 'kling3-reference-to-video') {
            finalImageUrl = image_url || null;

            if (!finalImageUrl && Array.isArray(imageFiles) && imageFiles.length > 0) {
                const first = imageFiles[0];
                finalImageUrl = await uploadToFal(first.buffer, first.filename, first.mimeType);
            }

            if (!finalImageUrl && Array.isArray(image_urls) && image_urls.length > 0) {
                const first = image_urls.find((u) => typeof u === 'string' && u);
                if (first) finalImageUrl = first;
            }

            if (selectedModel.requiresImage !== false && !finalImageUrl) {
                return res.status(400).json({ error: 'image_url or image file is required for this model' });
            }
        }

        if (selectedModel.kind === 'motion-control') {
            // Motion-control requires both image and video.
            if (!finalVideoUrl) {
                return res.status(400).json({ error: 'video_url or video file is required for this model' });
            }
            if (!finalImageUrl) {
                return res.status(400).json({ error: 'image_url or image file is required for this model' });
            }
        }

        if (selectedModel.kind === 'reference-to-video') {
            // Kling O1 reference-to-video expects start image + optional style references in image_urls,
            // and optional elements. We require at least one image.
            const hasAnyImageUrl =
                (typeof image_url === 'string' && image_url) ||
                (Array.isArray(image_urls) && image_urls.some((u) => typeof u === 'string' && u)) ||
                (Array.isArray(imageFiles) && imageFiles.length > 0);

            if (!hasAnyImageUrl) {
                return res.status(400).json({ error: 'At least one image (start frame) is required for this model' });
            }
        }

        const uploadedImageUrls = [];
        const shouldProcessImageUrls =
            (selectedModel.kind === 'video-to-video' || selectedModel.kind === 'reference-to-video' || selectedModel.kind === 'kling3-reference-to-video' || selectedModel.kind === 'kling3-video-to-video') &&
            selectedModel.usesImageUrls !== false;

        if (shouldProcessImageUrls) {
            if (Array.isArray(image_urls)) {
                for (const u of image_urls) {
                    if (typeof u === 'string' && u) uploadedImageUrls.push(u);
                }
            }

            if (typeof image_url === 'string' && image_url) {
                if (!uploadedImageUrls.includes(image_url)) {
                    uploadedImageUrls.unshift(image_url);
                }
            }

            if (Array.isArray(imageFiles) && imageFiles.length > 0) {
                for (const img of imageFiles) {
                    const u = await uploadToFal(img.buffer, img.filename, img.mimeType);
                    uploadedImageUrls.push(u);
                }
            }

            if (selectedModel.kind === 'video-to-video' && uploadedImageUrls.length > 4) {
                return res.status(400).json({ error: 'Maximum 4 reference images allowed' });
            }

            if (selectedModel.kind === 'reference-to-video' && uploadedImageUrls.length > 7) {
                return res.status(400).json({ error: 'Maximum 7 images allowed for this model' });
            }

            if (Array.isArray(elements) && elements.length > 0) {
                if (selectedModel.kind === 'video-to-video') {
                    // Kling O1 video-to-video reference: max 4 total (elements + image_urls)
                    if (elements.length + uploadedImageUrls.length > 4) {
                        return res.status(400).json({ error: 'Maximum 4 total (elements + reference images) allowed for this model' });
                    }
                }

                if (selectedModel.kind === 'reference-to-video') {
                    // Kling O1 reference-to-video: max 7 total (elements + reference images + start image)
                    // We cannot reliably detect which image is start vs reference here, so enforce elements + image_urls <= 7.
                    if (elements.length + uploadedImageUrls.length > 7) {
                        return res.status(400).json({ error: 'Maximum 7 total (elements + images) allowed for this model' });
                    }
                }
            }
        }

        const payload = {};
        // Handle Kling 3 prompt vs multi_prompt
        if (isKling3Model) {
            if (multi_prompt && Array.isArray(multi_prompt)) {
                payload.multi_prompt = multi_prompt;
            } else if (prompt) {
                payload.prompt = prompt;
            }
        } else if (selectedModel.requiresPrompt !== false) {
            payload.prompt = prompt;
        }

        const mergedOptions = {
            duration,
            aspect_ratio,
            keep_audio,
            video_id,
            ...(options && typeof options === 'object' ? options : {}),
        };

        const allowedOptions = Array.isArray(selectedModel.allowedOptions) ? selectedModel.allowedOptions : [];
        const optionTypes = (selectedModel.optionTypes && typeof selectedModel.optionTypes === 'object') ? selectedModel.optionTypes : null;

        if (optionTypes) {
            for (const [k, t] of Object.entries(optionTypes)) {
                const v = mergedOptions[k];
                if (typeof v === 'undefined' || v === null || v === '') continue;

                if (t === 'number') {
                    const n = (typeof v === 'number') ? v : Number(v);
                    if (!Number.isFinite(n)) {
                        return res.status(400).json({ error: `${k} must be a number` });
                    }
                    mergedOptions[k] = n;
                }
            }
        }
        for (const k of allowedOptions) {
            if (typeof mergedOptions[k] === 'undefined' || mergedOptions[k] === null || mergedOptions[k] === '') continue;
            // Map model-specific duration keys to the standard 'duration' parameter
            if (k === 'duration_sora' || k === 'duration_hailuo' || k === 'duration_grok' || k === 'duration_kling3') {
                payload['duration'] = mergedOptions[k];
            } else if (k === 'aspect_ratio_grok' || k === 'aspect_ratio_grok_i2v' || k === 'aspect_ratio_kling3' || k === 'aspect_ratio_o3_v2v') {
                payload['aspect_ratio'] = mergedOptions[k];
            } else if (k === 'resolution_grok') {
                payload['resolution'] = mergedOptions[k];
            } else if (k === 'shot_type_v3' || k === 'shot_type_customize') {
                payload['shot_type'] = mergedOptions[k];
            } else {
                payload[k] = mergedOptions[k];
            }
        }

        if (selectedModel.kind === 'video-id-to-video') {
            payload.video_id = video_id;
        }

        if (finalVideoUrl) {
            payload.video_url = finalVideoUrl;
        }

        if (selectedModel.kind === 'motion-control') {
            if (finalImageUrl) {
                payload.image_url = finalImageUrl;
            }
        }

        if (selectedModel.kind === 'image-to-video' || selectedModel.kind === 'kling3-image-to-video') {
            if (finalImageUrl) {
                if (selectedModel.startImageParam === 'start_image_url') {
                    payload.start_image_url = finalImageUrl;
                } else {
                    payload.image_url = finalImageUrl;
                }
            }

            if (selectedModel.supportsEndImage) {
                let endUrl =
                    (typeof end_image_url === 'string' && end_image_url) ? end_image_url
                        : ((typeof tail_image_url === 'string' && tail_image_url) ? tail_image_url : null);

                if (!endUrl && endImageFile) {
                    endUrl = await uploadToFal(endImageFile.buffer, endImageFile.filename, endImageFile.mimeType);
                }

                if (endUrl) {
                    if (selectedModel.endImageParam === 'tail_image_url') {
                        payload.tail_image_url = endUrl;
                    } else if (selectedModel.endImageParam === 'end_image_url') {
                        payload.end_image_url = endUrl;
                    } else {
                        payload.end_image_url = endUrl;
                    }
                }
            }
        }

        // Handle Kling 3 reference-to-video
        if (selectedModel.kind === 'kling3-reference-to-video') {
            if (finalImageUrl) {
                payload.image_url = finalImageUrl;
            }
        }

        if ((selectedModel.kind === 'video-to-video' || selectedModel.kind === 'reference-to-video' || selectedModel.kind === 'kling3-reference-to-video' || selectedModel.kind === 'kling3-video-to-video') && selectedModel.usesImageUrls !== false) {
            if (uploadedImageUrls.length > 0) {
                payload.image_urls = uploadedImageUrls;
            }

            if (Array.isArray(elements) && elements.length > 0) {
                payload.elements = elements;
            }
        }

        // Handle Kling 3 elements for image-to-video
        if (selectedModel.supportsElements && Array.isArray(elements) && elements.length > 0) {
            payload.elements = elements;
        }

        // Submit request to fal.ai
        const response = await fetch(selectedModel.endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Key ${FAL_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('FAL API Error:', errorText);
            let parsed;
            try {
                parsed = JSON.parse(errorText);
            } catch {
                parsed = null;
            }

            const message = (parsed && (parsed.error || parsed.message))
                ? (parsed.error || parsed.message)
                : `FAL API error: ${response.status} ${response.statusText}`;

            return res.status(response.status).json({
                error: message,
                details: parsed || errorText,
            });
        }

        const data = await response.json();
        const requestId = data.request_id || data.requestId || data.id || null;

        const statusUrl = data.status_url || (requestId ? `${selectedModel.endpoint}/requests/${requestId}/status` : null);
        const responseUrl = data.response_url || (requestId ? `${selectedModel.endpoint}/requests/${requestId}` : null);

        if (!statusUrl) {
            return res.status(502).json({
                error: 'FAL API returned no status_url',
                details: data,
            });
        }

        // Return the request ID and status URLs
        return res.status(200).json({
            request_id: requestId,
            status_url: statusUrl,
            response_url: responseUrl,
        });

    } catch (error) {
        console.error('Video generation error:', error);
        return res.status(500).json({
            error: error.message || 'Internal server error'
        });
    }
}

module.exports.config = config;
module.exports.VIDEO_MODELS = VIDEO_MODELS;
module.exports.OPTION_DEFS = OPTION_DEFS;
