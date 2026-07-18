declare module "@php-wasm/universal" {
  export class PHP {
    constructor(runtimeId: number)
    run(request: { code: string }): Promise<{ bytes: Uint8Array; text: string }>
    mkdir(path: string): void
    readFileAsBuffer(path: string): Uint8Array
    writeFile(path: string, data: Uint8Array): void
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
