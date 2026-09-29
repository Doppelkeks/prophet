// @ts-check
// Uniform message ports so the same job-system code runs with browser Web Workers and with
// Node worker_threads (tests). No Node imports here: callers pass in their objects.

/**
 * Worker side: the port a job worker uses to talk to the engine.
 * @typedef {{ post(message: any, transfer?: Transferable[]): void, listen(handler: (message: any) => void): void }} WorkerPort
 */

/**
 * Engine side: a handle to one job worker.
 * @typedef {{ post(message: any, transfer?: Transferable[]): void, onMessage(handler: (message: any) => void): void, terminate(): void }} WorkerHandle
 */

export class WorkerPorts {
  /**
   * Port for code running inside a browser worker (`self`).
   * @param {{ postMessage(message: any, options?: StructuredSerializeOptions): void, onmessage: ((e: MessageEvent) => any) | null }} scope
   * @returns {WorkerPort}
   */
  static fromScope(scope) {
    return {
      post: (message, transfer) => scope.postMessage(message, transfer ? { transfer } : undefined),
      listen: (handler) => {
        scope.onmessage = (e) => handler(e.data);
      },
    };
  }

  /**
   * Port for code running in a Node worker thread (`parentPort` from node:worker_threads).
   * @param {{ postMessage(message: any, transfer?: any[]): void, on(event: 'message', handler: (message: any) => void): void }} parentPort
   * @returns {WorkerPort}
   */
  static fromNode(parentPort) {
    return {
      post: (message, transfer) => parentPort.postMessage(message, transfer),
      listen: (handler) => parentPort.on('message', handler),
    };
  }

  /**
   * Engine-side handle for a Node `worker_threads` Worker (tests and tools). The caller constructs the
   * worker, so this module needs no Node imports.
   * @param {{ postMessage(message: any, transfer?: any[]): void, on(event: string, handler: (arg: any) => void): any, terminate(): any }} worker
   * @returns {WorkerHandle}
   */
  static wrapNode(worker) {
    return {
      post: (message, transfer) => worker.postMessage(message, transfer),
      onMessage: (handler) => {
        worker.on('message', handler);
        worker.on('error', (err) => handler({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
      },
      terminate: () => void worker.terminate(),
    };
  }

  /**
   * Engine-side handle for a browser module worker.
   * @param {URL | string} url
   * @param {string} name
   * @returns {WorkerHandle}
   */
  static spawnBrowser(url, name) {
    const worker = new Worker(url, { type: 'module', name });
    return {
      post: (message, transfer) => worker.postMessage(message, transfer ? { transfer } : undefined),
      onMessage: (handler) => {
        worker.onmessage = (e) => handler(e.data);
        worker.onerror = (e) => handler({ type: 'error', message: e.message || 'worker failed to load' });
      },
      terminate: () => worker.terminate(),
    };
  }
}
