'use strict'

const test = require('brittle')
const ImgStableDiffusion = require('../../index')

const files = {
  model: '/models/flux.gguf',
  llm: '/models/encoder.gguf',
  vae: '/models/vae.safetensors'
}
const logger = { error() {}, warn() {}, info() {}, debug() {} }

async function configAtLoad(config) {
  const model = new ImgStableDiffusion({ files, config, logger })
  let actual
  model._createAddon = (params) => {
    actual = params.config
    return { activate: () => Promise.resolve(), unload: () => Promise.resolve() }
  }
  await model.load()
  await model.unload()
  return actual
}

test('explicit CUDA FLUX.2 loads use the GEMM VAE without mutating caller configuration', async (t) => {
  for (const backend of ['cuda0', 'cuda2', 'CUDA0']) {
    const config = Object.freeze({ backend, prediction: 'flux2_flow', type: 'auto' })
    t.alike(await configAtLoad(config), { ...config, vae_conv_direct: false })
    t.absent(config.vae_conv_direct)
  }
})

test('CUDA FLUX.2 preserves explicit convolution settings', async (t) => {
  for (const vae_conv_direct of [true, false, 'true', 'false']) {
    const config = { backend: 'cuda0', prediction: 'flux2_flow', vae_conv_direct }
    t.is(await configAtLoad(config), config)
  }
})

test('CUDA FLUX.2 applies caller changes before loading and reloading', async (t) => {
  const config = { backend: 'cuda0', prediction: 'flux2_flow' }
  const model = new ImgStableDiffusion({ files, config, logger })
  const actual = []
  model._createAddon = (params) => {
    actual.push(params.config)
    return { activate: () => Promise.resolve(), unload: () => Promise.resolve() }
  }
  config.vae_conv_direct = true
  await model.load()
  t.is(actual[0], config)
  await model.unload()
  delete config.vae_conv_direct
  await model.load()
  t.alike(actual[1], { ...config, vae_conv_direct: false })
  t.absent(config.vae_conv_direct)
  await model.unload()
})

test('other backends, models, precision overrides and CPU fallback retain their configuration', async (t) => {
  const base = { backend: 'cuda0', prediction: 'flux2_flow' }
  for (const change of [
    { backend: undefined },
    { backend: 'cpu' },
    { backend: 'metal' },
    { backend: 'vulkan0' },
    { backend: 'rocm0' },
    { backend: 'cuda0,vae=cpu' },
    { backend: 'diffusion=cuda0,vae=cpu' },
    { device: 'cpu' },
    { prediction: undefined },
    { prediction: 'flow' },
    { vae_auto_cpu_fallback: true },
    { vae_auto_cpu_fallback: 'true' },
    { type: 'f32' },
    { type: 'f16' },
    { type: 'bf16' },
    { tensor_type_rules: '^vae.=f32' }
  ]) {
    const config = { ...base, ...change }
    t.is(await configAtLoad(config), config, JSON.stringify(change))
  }
})
