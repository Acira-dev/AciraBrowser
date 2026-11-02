import type { BrowserAction, BrowserSnapshot } from '../../runtime/types';
import type { ProfileSettings } from '../../runtime/profileSettings';
import {profileHasSetting} from '../../runtime/profileSettings';
import {profileScopeAction,profileScopeOwner,scopedSettingAction} from '../../ui/profileScope';
import { Select, SettingRow } from './controls';

import { t } from '../../i18n';
type Key = keyof ProfileSettings;
type Props = { state: BrowserSnapshot; dispatch: (action: BrowserAction) => void };

/** Writes `key` where it applies now: the profile's own setting when it has one, else the setting for all profiles. */
export function scopedSetting(state: BrowserSnapshot, dispatch: Props['dispatch'], key: Key, value: string, global: () => void) {
  const action=scopedSettingAction(state,key,value);
  if (action) dispatch(action);
  else global();
}

/** "Applies to: All profiles / This profile", said plainly under a setting a profile can keep for itself
 *  (runtime/profileSettings.ts). This profile keeps the current value as its own; All profiles drops it, so the
 *  profile follows the shared setting again. Hidden with a single profile and in private windows. */
export function ProfileScope({ state, dispatch, setting, id }: Props & { setting: Key; id: string }) {
  const profile = profileScopeOwner(state);
  if (!profile || state.browserProfiles.filter(item=>!item.private).length<2) return null;
  const own = profileHasSetting(profile.settings,setting);
  return (
    <SettingRow
      id={id}
      title={t("profilescope.appliesTo")}
      detail={own ? `Only ${profile.name}. Other profiles keep their own.` : 'Every profile, unless a profile sets its own.'}
    >
      <Select
        label={t("profilescope.appliesTo")}
        value={own ? 'profile' : 'all'}
        options={[
          { value: 'all', label: t("profilescope.allProfiles") },
          { value: 'profile', label: t("profilescope.thisProfile") },
        ]}
        onChange={(scope) =>
          {const action=profileScopeAction(state,setting,scope==='profile');if(action)dispatch(action);}
        }
      />
    </SettingRow>
  );
}
