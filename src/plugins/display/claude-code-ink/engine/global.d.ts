// Ink global type augmentations
import type { DOMElement } from './dom.js';

declare global {
  // Ink augments JSX elements with its own DOM types
  namespace JSX {
    interface IntrinsicElements {
      [elemName: string]: any;
    }
  }
}
