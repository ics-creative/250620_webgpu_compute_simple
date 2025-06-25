// GPUAdapterを取得する
const adapter = await navigator.gpu.requestAdapter();
// GPUAdapterからGPUDeviceを取得する
const device = await adapter.requestDevice();

// language=WGSL
const computeShaderWGSL = `
// バインド0に符号なし整数型のストレージ配列を定義する
@binding(0) @group(0) var<storage, read_write> storageData:array<u32>;

// コンピュートシェーダーのメイン関数定義。ワークグループのスレッドサイズは8×1×1
@compute @workgroup_size(8, 1, 1)
fn main(
  // ビルトイン引数global_invocation_idをgidという名前で使用
  @builtin(global_invocation_id) gid:vec3<u32>,
) {
  // 各スレッドはスレッド番号に対応したインデックスのデータをストレージ配列から読み取り、1を足して格納する
  storageData[gid.x] = storageData[gid.x] + 1u;
}
`;

// createComputePipeline()でlayoutを"auto"にせず、
// 自分で作成する場合のGPUBindGroupLayout
// const bindGroupLayout = device.createBindGroupLayout({
//   entries: [
//     {
//       binding: 0,
//       visibility: GPUShaderStage.COMPUTE,
//       buffer: {
//         type: "storage",
//       },
//     },
//   ],
// });

// WGSLをコンパイルし、パイプラインを作成する
const computePipeline = device.createComputePipeline({
  layout: "auto", // layout: bindGroupLayout
  compute: {
    module: device.createShaderModule({ code: computeShaderWGSL }),
    entryPoint: "main",
  },
});

// GPUに転送するデータを作る
const storageData = new Uint32Array(8);
for (let i = 0; i < storageData.length; i++) {
  storageData[i] = Math.floor(Math.random() * 100);
}
document.getElementById("input").textContent = `input: [${storageData}]`;

// GPUで使用するバッファーを作る
const storageBuffer = device.createBuffer({
  size: storageData.byteLength,
  usage:
    GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
});
// 非同期に値を転送
device.queue.writeBuffer(storageBuffer, 0, storageData);

// GPUから値をコピーするバッファーを作る
const readbackBuffer = device.createBuffer({
  size: storageData.byteLength,
  usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
});

// 作成したパイプラインからバインドグループレイアウトを取得する
const bindGroupLayout = computePipeline.getBindGroupLayout(0);

// バインドグループレイアウトのフォーマットに沿ったバインドグループを作成する
const bindGroup = device.createBindGroup({
  layout: bindGroupLayout,
  entries: [
    {
      binding: 0,
      resource: { buffer: storageBuffer },
    },
  ],
});

// コマンドエンコーダーを作成する
const commandEncoder = device.createCommandEncoder();

// コマンド①：コンピュートシェーダーの実行
// コンピュートパスを作成する
const passEncoder = commandEncoder.beginComputePass();
// 使用するパイプラインをセットする
passEncoder.setPipeline(computePipeline);
// 使用するバインドグループをセットする
passEncoder.setBindGroup(0, bindGroup);
// コンピュートシェーダーの実行命令を呼び出す
passEncoder.dispatchWorkgroups(1, 1, 1);
// コンピュートパスの設定を完了する
passEncoder.end();

// コマンド②：結果をJavaScriptから参照できるバッファーにコピー
commandEncoder.copyBufferToBuffer(
  storageBuffer,
  0,
  readbackBuffer,
  0,
  storageData.byteLength,
);

// コマンドをキューに追加する
device.queue.submit([commandEncoder.finish()]);

// バッファーをマップしてJavaScriptから参照できるようにする
await readbackBuffer.mapAsync(GPUMapMode.READ);
// マップ完了後、ArrayBufferを取得する
const result = new Uint32Array(readbackBuffer.getMappedRange());
// 計算結果を表示
document.getElementById("output").textContent = `output: [${result}]`;
// バッファーをアンマップして再度GPUから使用可能にする
readbackBuffer.unmap();
