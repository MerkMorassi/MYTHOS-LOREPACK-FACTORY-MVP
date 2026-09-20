import { createServer } from '../server.js';

let app: any;

export default async function handler(req: any, res: any) {
  if (!app) {
    app = await createServer();
  }
  return app(req, res);
}
