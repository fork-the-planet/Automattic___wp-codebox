declare module "@php-wasm/universal" {
  export class PHP {
    constructor(runtimeId: number)
    run(request: { code: string }): Promise<{ text: string }>
    exit(code?: number): void
  }

  export function loadPHPRuntime(loader: {
    dependencyFilename: string
    dependenciesTotalSize: number
    phpWasmAsyncMode: "asyncify"
    init: unknown
  }, options: {
    instantiateWasm: unknown
  }): Promise<number>

  export class PHPRequestHandler {
    getPrimaryPhp(): Promise<PHP>
  }
}
