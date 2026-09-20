import { createServer } from '../server.js';

/**
 * Vercel Serverless Function entry point.
 * This file acts as a bridge between Vercel's serverless environment
 * and the existing Express application defined in server.ts.
 */

let app: any;

export default async function handler(req: any, res: any) {
  // Initialize the Express app only once (singleton pattern)
  if (!app) {
    app = await createServer();
  }
  
  // Forward the request to the Express application
  return app(req, res);
}
