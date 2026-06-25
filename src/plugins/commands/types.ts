import { CommandInterceptResult, InjectedMessage } from '../../contract.js';

export type CommandAction = 'exit' | 'skipAgent' | 'injectAndContinue';

export interface BuiltinCommand<C = any> {
  name: string;
  aliases?: string[];
  description: string;
  handler(ctx?: C): Promise<CommandInterceptResult>;
}

export interface SkillInvokeResult {
  messages?: InjectedMessage[];
  forkResult?: string;
}
