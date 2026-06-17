declare module 'marked-terminal' {
  import { Renderer } from 'marked';
  export default class TerminalRenderer extends Renderer {
    constructor(options?: any);
  }
}
