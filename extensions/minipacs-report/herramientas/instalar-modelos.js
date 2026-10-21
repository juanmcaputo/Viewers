// Baja los modelos (Whisper tiny q8 + Silero VAD fp32) de Hugging Face, fijando el
// commit del repo, verifica cada archivo contra el hash que publica Hugging Face
// (sha256 de LFS o hash de blob de git) y recien entonces los copia a
// extensions/minipacs-report/public/minipacs/models/. Copia tambien los 4 archivos de ONNX Runtime
// Web 1.22 de Transformers.js a extensions/minipacs-report/public/minipacs/ort/. Escribe FUENTES.txt.
// Uso: node instalar-modelos.js <ruta a ohif-customs/Viewers> <carpeta temporal>
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const [ , , VIEWERS, TEMP ] = process.argv;
const PUBLICO = path.join(VIEWERS, 'extensions/minipacs-report/public/minipacs');

const MODELOS = {
  'onnx-community/whisper-tiny': [
    'config.json', 'generation_config.json', 'preprocessor_config.json',
    'tokenizer.json', 'tokenizer_config.json',
    'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx',
    // WebGPU (placa de video): encoder fp32 + decoder q4, lo recomendado por Transformers.js
    'onnx/encoder_model.onnx', 'onnx/decoder_model_merged_q4.onnx',
  ],
  // Placas integradas (ej. Intel Iris Xe) con fp16
  'onnx-community/whisper-base': [
    'config.json', 'generation_config.json', 'preprocessor_config.json',
    'tokenizer.json', 'tokenizer_config.json',
    'onnx/encoder_model.onnx', 'onnx/encoder_model_fp16.onnx', 'onnx/decoder_model_merged_q4.onnx',
  ],
  // GPU con fp16 (shader-f16), segun la prueba de velocidad. Pesados: NO van a git.
  'onnx-community/whisper-small': [
    'config.json', 'generation_config.json', 'preprocessor_config.json',
    'tokenizer.json', 'tokenizer_config.json',
    'onnx/encoder_model_fp16.onnx', 'onnx/decoder_model_merged_q4.onnx',
  ],
  'onnx-community/whisper-large-v3-turbo': [
    'config.json', 'generation_config.json', 'preprocessor_config.json',
    'tokenizer.json', 'tokenizer_config.json',
    'onnx/encoder_model_q4f16.onnx', 'onnx/decoder_model_merged_q4f16.onnx',
  ],
  'onnx-community/silero-vad': ['onnx/model.onnx', 'LICENSE'],
};
const ORT_DIST = path.join(VIEWERS, 'node_modules/@huggingface/transformers/node_modules/onnxruntime-web');
const ORT_ARCHIVOS = ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm',
                      'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm'];

const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const blobGit = b => crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
const json = async u => { const r = await fetch(u); if (!r.ok) throw new Error(`${u} -> ${r.status}`); return r.json(); };

(async () => {
  const fuentes = [
    `# Archivos servidos por OHIF en /minipacs/ (transcripcion local en el navegador).`,
    `# Generado ${new Date().toISOString()} por instalar-modelos.js. Formato: sha256  tamano  archivo  <-  origen`,
  ];
  for (const [id, archivos] of Object.entries(MODELOS)) {
    const info = await json(`https://huggingface.co/api/models/${id}`);
    const commit = info.sha;
    const arbol = await json(`https://huggingface.co/api/models/${id}/tree/${commit}?recursive=1`);
    const porRuta = new Map(arbol.map(f => [f.path, f]));
    fuentes.push(`#`, `# ${id} @ commit ${commit} (licencia: ${(info.cardData && info.cardData.license) || '?'})`);
    for (const archivo of archivos) {
      const meta = porRuta.get(archivo);
      if (!meta) throw new Error(`${id}: no existe ${archivo}`);
      const url = `https://huggingface.co/${id}/resolve/${commit}/${archivo}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${url} -> ${r.status}`);
      const datos = Buffer.from(await r.arrayBuffer());
      const ok = meta.lfs ? sha256(datos) === meta.lfs.oid : blobGit(datos) === meta.oid;
      if (!ok) throw new Error(`HASH DISTINTO: ${id}/${archivo}`);
      const temporal = path.join(TEMP, id, archivo);
      fs.mkdirSync(path.dirname(temporal), { recursive: true });
      fs.writeFileSync(temporal, datos);
      const destino = path.join(PUBLICO, 'models', id, archivo);
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.copyFileSync(temporal, destino);
      fuentes.push(`${sha256(datos)}  ${String(datos.length).padStart(9)}  models/${id}/${archivo}  <-  ${url}`);
      console.log(`OK  ${(datos.length / 1048576).toFixed(1).padStart(5)} MB  ${id}/${archivo}  (verificado con ${meta.lfs ? 'sha256 LFS' : 'hash de git'})`);
    }
  }
  const versionOrt = require(path.join(ORT_DIST, 'package.json')).version;
  fuentes.push(`#`, `# onnxruntime-web ${versionOrt} (dependencia de @huggingface/transformers 3.8.1; licencia MIT)`);
  fs.mkdirSync(path.join(PUBLICO, 'ort'), { recursive: true });
  for (const archivo of ORT_ARCHIVOS) {
    const origen = path.join(ORT_DIST, 'dist', archivo);
    const datos = fs.readFileSync(origen);
    fs.copyFileSync(origen, path.join(PUBLICO, 'ort', archivo));
    fuentes.push(`${sha256(datos)}  ${String(datos.length).padStart(9)}  ort/${archivo}  <-  node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/${archivo}`);
    console.log(`OK  ${(datos.length / 1048576).toFixed(1).padStart(5)} MB  ort/${archivo}  (onnxruntime-web ${versionOrt})`);
  }
  fs.writeFileSync(path.join(PUBLICO, 'FUENTES.txt'), fuentes.join('\n') + '\n');
  console.log('\nescrito', path.join(PUBLICO, 'FUENTES.txt'));
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
