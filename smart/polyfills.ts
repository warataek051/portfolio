import { Buffer } from 'buffer';
import process from 'process';

if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}

if (typeof global.process === 'undefined') {
  global.process = process as any;
} else {
  global.process = global.process || (process as any);
}

(global.process as any).env = (global.process as any).env || {};
(global.process as any).browser = true;
(global.process as any).version = (global.process as any).version || 'v0.0';
if (typeof global.process.nextTick !== 'function') {
  global.process.nextTick = process.nextTick.bind(process);
}

if (typeof global.location === 'undefined') {
  (global as any).location = { protocol: 'https:' };
}
