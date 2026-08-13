export const transformerContext = {
	AutoTokenizer: null,
	AutoModelForCausalLM: null,
	AutoModelForImageTextToText: null,
	AutoModelForVision2Seq: null,
	AutoModelForSeq2SeqLM: null,
	AutoProcessor: null,
	Gemma4ForConditionalGeneration: null,
	Florence2ForConditionalGeneration: null,
	ModelRegistry: null,
	pipelineFactory: null,
	TextStreamer: null,
	loadImage: null,
	transformers: null,
	webgpuCapabilities: {
		available: false,
		supportsF16: false,
		features: [],
		maxBufferSize: 0,
		maxStorageBufferBindingSize: 0,
	},
};

export function getTransformersContext() {
	return transformerContext;
}

export function getWebgpuCapabilities() {
	return transformerContext.webgpuCapabilities;
}
