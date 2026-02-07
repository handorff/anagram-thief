declare module "express" {
  type IncomingMessage = import("node:http").IncomingMessage;
  type ServerResponse = import("node:http").ServerResponse;

  export type Request = IncomingMessage & {
    body?: unknown;
    params: Record<string, string>;
    query?: Record<string, string | string[]>;
    ip?: string;
    header: (name: string) => string | undefined;
  };

  export type Response = ServerResponse & {
    sendFile: (path: string) => void;
    status: (statusCode: number) => Response;
    json: (body: unknown) => Response;
  };

  export type NextFunction = () => void;

  type Handler = (req: Request, res: Response, next?: NextFunction) => void;

  interface ExpressApp {
    (req: IncomingMessage, res: ServerResponse): void;
    use: (...args: unknown[]) => ExpressApp;
    get: (path: string, ...handlers: Handler[]) => ExpressApp;
    post: (path: string, ...handlers: Handler[]) => ExpressApp;
  }

  interface ExpressFactory {
    (): ExpressApp;
    json: () => unknown;
    static: (root: string) => unknown;
  }

  const express: ExpressFactory;
  export default express;
}
