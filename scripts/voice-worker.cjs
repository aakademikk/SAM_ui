/**
 * SAM — Parakeet recognizer worker, forked by src/lib/server/voice/recognizer.ts.
 *
 * Holds the ~1.5 GB model so the server process never does. Receives
 * { id, pcm } (16 kHz mono f32le) over IPC, replies { id, text } or
 * { id, error }. The parent kills it after its idle window; it also exits if
 * the parent goes away.
 */

const path = require('node:path');

const MODEL_DIR = process.argv[2];
let recognizer = null;

function getRecognizer() {
  if (!recognizer) {
    const sherpa = require('sherpa-onnx-node');
    recognizer = new sherpa.OfflineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 128 },
      modelConfig: {
        transducer: {
          encoder: path.join(MODEL_DIR, 'encoder.int8.onnx'),
          decoder: path.join(MODEL_DIR, 'decoder.int8.onnx'),
          joiner: path.join(MODEL_DIR, 'joiner.int8.onnx'),
        },
        tokens: path.join(MODEL_DIR, 'tokens.txt'),
        numThreads: 4,
      },
    });
  }
  return recognizer;
}

process.on('message', ({ id, pcm }) => {
  try {
    const r = getRecognizer();
    const buf = Buffer.from(pcm);
    const samples = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
    const stream = r.createStream();
    stream.acceptWaveform({ samples, sampleRate: 16000 });
    r.decode(stream);
    process.send({ id, text: (r.getResult(stream)?.text ?? '').trim() });
  } catch (err) {
    process.send({ id, error: err instanceof Error ? err.message : String(err) });
  }
});

process.on('disconnect', () => process.exit(0));
