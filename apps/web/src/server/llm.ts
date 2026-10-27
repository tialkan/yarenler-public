import 'server-only';
import {readFileSync} from 'node:fs';
/**
 * OpenRouter key from the existing configuration: OPENROUTER_API_KEY_FILE (path to a file that holds only
 * the key) when set, otherwise the OPENROUTER_API_KEY runtime variable. The key is never logged.
 */
export function openRouterKey():string|null{
 const file=process.env.OPENROUTER_API_KEY_FILE;
 if(file){try{const key=readFileSync(file,'utf8').trim();if(key)return key;}catch{/* fall back to the variable */}}
 return process.env.OPENROUTER_API_KEY?.trim()||null;
}
