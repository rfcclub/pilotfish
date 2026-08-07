import { describe, it, expect } from 'vitest'
import { createSubprocessModelCaller } from '../src/model-caller.ts'

describe('createSubprocessModelCaller', () => {
  it('throws immediately if no modelCommand is configured', () => {
    expect(() => createSubprocessModelCaller({ roles: {} })).toThrow(/modelCommand/)
  })

  it('runs a real subprocess, substitutes {model}/{promptFile}, parses its JSON stdout', async () => {
    // A real fake "model": a shell command that reads the prompt file (proving
    // {promptFile} really points at real, readable content) and echoes a files object.
    const modelCaller = createSubprocessModelCaller({
      roles: { apply: 'fake-model-x' },
      modelCommand: `node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync(process.argv[1],'utf-8')); console.log(JSON.stringify({files:{'out.txt': p.model+':'+p.task.id}}))" {promptFile}`,
    })

    const result = await modelCaller({
      role: 'apply',
      model: 'fake-model-x',
      task: {
        id: 'TASK-9', status: 'pending', behavior: 'b', acceptance: 'a',
        files: [], test: 't.test.ts', consumes: [], produces: [],
      },
      attempt: 1,
    })

    expect(result.files['out.txt']).toBe('fake-model-x:TASK-9')
  })

  it('throws a clear error when the subprocess prints non-JSON', async () => {
    const modelCaller = createSubprocessModelCaller({
      roles: { apply: 'x' },
      modelCommand: 'echo "not json"',
    })
    await expect(
      modelCaller({ role: 'apply', model: 'x', task: {
        id: 'T', status: 'pending', behavior: 'b', acceptance: 'a', files: [], test: 't', consumes: [], produces: [],
      }, attempt: 1 }),
    ).rejects.toThrow(/not valid JSON/)
  })

  it('throws a clear error when JSON is valid but missing "files"', async () => {
    const modelCaller = createSubprocessModelCaller({
      roles: { apply: 'x' },
      modelCommand: 'echo \'{"wrong":"shape"}\'',
    })
    await expect(
      modelCaller({ role: 'apply', model: 'x', task: {
        id: 'T', status: 'pending', behavior: 'b', acceptance: 'a', files: [], test: 't', consumes: [], produces: [],
      }, attempt: 1 }),
    ).rejects.toThrow(/missing a "files"/)
  })
})
