import { startViewer } from './viewer';

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const q = new URLSearchParams(location.search);
if (q.has('viewer')) startViewer(canvas);
