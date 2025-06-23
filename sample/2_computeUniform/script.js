const count = 8;
const radius = 50;

async function init() {
  // GPUAdapterを取得する
  const adapter = await navigator.gpu.requestAdapter();
  // GPUAdapterからGPUDeviceを取得する
  const device = await adapter.requestDevice({});

  // language=WGSL
  const computeShaderWGSL = `
  // 定数バッファーで使用する構造体
  struct Uniform {
    time:f32,
    amplitude:f32,
  }
  
  // バインド0に32ビット浮動小数点数型のストレージ配列を定義する
  @binding(0) @group(0) var<storage, read_write> storageData:array<f32>;
  // バインド1に定数バッファーの構造体を定義する
  @binding(1) @group(0) var<uniform> uniformData:Uniform;
  
  // コンピュートシェーダーのメイン関数定義。ワークグループのスレッドサイズは8×1×1
  @compute @workgroup_size(${count}, 1, 1)
  fn main(
    // ビルトイン引数global_invocation_idをgidという名前で使用
    @builtin(global_invocation_id) gid:vec3<u32>,
  ) {
    // 各スレッドはスレッド番号に対応したインデックスのデータをストレージ配列から読み取り、定数バッファーに応じた時間や振幅でボールの座標を計算する
    storageData[gid.x] = uniformData.amplitude * 0.5 * (1.0 + sin(uniformData.time * 0.002 + f32(gid.x) * 0.5));
  }
  `;

  // createComputePipeline()でlayoutを"auto"にせず、
  // 本来自分で作成するべきGPUBindGroupLayout
  // const bindGroupLayout = device.createBindGroupLayout({
  //   entries: [
  //     {
  //       binding: 0,
  //       visibility: GPUShaderStage.COMPUTE,
  //       buffer: {
  //         type: "storage",
  //       },
  //     },
  //     {
  //       binding: 1,
  //       visibility: GPUShaderStage.COMPUTE,
  //       buffer: {
  //         type: "uniform",
  //       },
  //     },
  //   ],
  // });

  // WGSLをコンパイルし、パイプラインを作成する
  const computePipeline = device.createComputePipeline({
    layout: "auto",
    compute: {
      module: device.createShaderModule({ code: computeShaderWGSL }),
      entryPoint: "main",
    },
  });

  // GPUで使用するバッファーの大きさを計算。ボールの数*4バイト
  const storageDataByteLength = count * Float32Array.BYTES_PER_ELEMENT;

  // GPUで使用するstorageバッファーを作る。CPUから初期値の転送は不要
  const storageBuffer = device.createBuffer({
    size: storageDataByteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });

  // GPUから値をコピーするバッファーを作る
  const readbackBuffer = device.createBuffer({
    size: storageDataByteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  // GPUに転送する定数バッファーのデータを作る。f32の変数を2つ
  const uniformData = new Float32Array(2);
  // GPUで使用する定数バッファーを作る
  const uniformBuffer = device.createBuffer({
    size: uniformData.byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
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
      {
        binding: 1,
        resource: { buffer: uniformBuffer },
      },
    ],
  });

  const container = document.getElementById("contents");
  const dotList = [...Array(count).keys()].map((i) => {
    const hue = (i * 360) / count;
    const dot = document.createElement("div");
    dot.classList.add("circle");
    dot.style.width = `${radius}px`;
    dot.style.height = `${radius}px`;
    dot.style.backgroundColor = `hsl(${hue}, 100%, 50%)`;
    container.appendChild(dot);
    return dot;
  });

  const frame = async (timestamp) => {
    // uniformで使用する値を設定し、GPUのバッファーに転送する
    uniformData[0] = timestamp;
    uniformData[1] = window.innerHeight - radius;
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);

    // コマンドを作成する
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
      storageDataByteLength,
    );

    // コマンドをキューに追加する
    device.queue.submit([commandEncoder.finish()]);

    // バッファーをマップしてJavaScriptから参照できるようにする
    await readbackBuffer.mapAsync(GPUMapMode.READ);
    // マップ完了後、ArrayBufferを取得する
    const result = new Float32Array(readbackBuffer.getMappedRange());
    // 計算結果を使用してボールの座標を更新
    dotList.forEach((div, index) => {
      const posX = ((window.innerWidth - radius) / (count - 1)) * index;
      const posY = result[index];
      div.style.transform = `translate(${posX}px, ${posY}px)`;
    });
    // バッファーをアンマップして再度GPUから使用可能にする
    readbackBuffer.unmap();

    requestAnimationFrame(frame);
  };
  frame(performance.now());
}

window.addEventListener("DOMContentLoaded", init);
