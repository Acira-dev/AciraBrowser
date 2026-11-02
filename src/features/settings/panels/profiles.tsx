import type { SettingsPanel } from '../panels';
import { ProfileManager } from '../../accounts/ProfileManager';

/** Stream F: local profile list with rename, color, remove and create. */
const panel: SettingsPanel = { section: 'Profiles', order: 10, Component: ProfileManager };
export default panel;
