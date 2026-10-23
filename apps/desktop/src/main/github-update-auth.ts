import type {DataService} from '@free-new-desk/data-service';
// Never expose a credential left in an imported legacy settings store.
export const GITHUB_UPDATE_CREDENTIAL_KEY='update.credential.github';
export function publicUpdateSettings(store:Pick<DataService,'listSettings'>):Record<string,string>{
  return Object.fromEntries(Object.entries(store.listSettings()).filter(([key])=>key!==GITHUB_UPDATE_CREDENTIAL_KEY));
}
