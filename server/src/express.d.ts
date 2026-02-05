declare module "express" {
  type IncomingMessage = import("node:http").IncomingMessage;
  type ServerResponse = import("node:http").ServerResponse;

  type ResponseWithSendFile = ServerResponse & { sendFile: (path: string) => void };
  type Handler = (req: IncomingMessage, res: ResponseWithSendFile) => void;

  interface ExpressApp {
    (req: IncomingMessage, res: ServerResponse): void;
    use: (...args: unknown[]) => ExpressApp;
    get: (path: string, handler: Handler) => ExpressApp;
  }

  interface ExpressFactory {
    (): ExpressApp;
    json: () => unknown;
    static: (root: string) => unknown;
  }

  const express: ExpressFactory;
  export default express;
}
