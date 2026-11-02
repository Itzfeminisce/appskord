// Loaded into the worklet scope before RNNoise: its processor outputs silence until its wasm is running and never
// says when, so this wraps it to post 'ready' on its node's port at that moment.
const register = registerProcessor;
const RNNOISE = '@sapphi-red/web-noise-suppressor/rnnoise';

globalThis.registerProcessor = (name, Processor) => {
  if (name !== RNNOISE) return register(name, Processor);
  return register(name, class extends Processor {
    constructor(options) {
      super(options);
      let current = this.processor;
      const ready = () => this.port.postMessage('ready');
      Object.defineProperty(this, 'processor', {
        configurable: true,
        get: () => current,
        set: (value) => {
          if (value && !current) ready();
          current = value;
        },
      });
      if (current) ready();
    }
  });
};
