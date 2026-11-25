import { AppWindow, AudioLines, Crop, FileClock, FolderOpen, FolderTree, GalleryHorizontalEnd, Images, Import, Layers, Moon, PanelLeft, PanelRight, PanelTop, Rocket, ScanSearch, SquareCode, SquareDashed, TextSearch, Zap } from 'lucide-react';

/** Beta 14, the one-time "Welcome to Beta 14" screen: what the Welcome step says. The six highlights, then the other fourteen features on request
 * ("And 14 more in Beta 14"). Words are i18n keys (`b14welcome.f1.name`, `.line`, `b14welcome.m1.name`...); the icons are the sample's. */
type Icon = typeof Layers;
export interface Feature { icon: Icon; id: string }

export const FEATURES: readonly Feature[] = [
  { icon: GalleryHorizontalEnd, id: 'f1' },
  { icon: FolderTree, id: 'f2' },
  { icon: Layers, id: 'f3' },
  { icon: AudioLines, id: 'f4' },
  { icon: FileClock, id: 'f5' },
  { icon: Crop, id: 'f6' },
];

export const MORE: readonly Feature[] = [
  { icon: Zap, id: 'm1' },
  { icon: PanelRight, id: 'm2' },
  { icon: PanelTop, id: 'm3' },
  { icon: PanelLeft, id: 'm4' },
  { icon: SquareCode, id: 'm5' },
  { icon: ScanSearch, id: 'm6' },
  { icon: TextSearch, id: 'm7' },
  { icon: Rocket, id: 'm8' },
  { icon: FolderOpen, id: 'm9' },
  { icon: Images, id: 'm10' },
  { icon: AppWindow, id: 'm11' },
  { icon: Import, id: 'm12' },
  { icon: Moon, id: 'm13' },
  { icon: SquareDashed, id: 'm14' },
];

export type WelcomeStep = 'welcome' | 'gift' | 'card';
/** The same three steps for everyone; only the words and the art change. */
export const STEPS: readonly WelcomeStep[] = ['welcome', 'gift', 'card'];
/** The mark a profile carries: the Insider seal on an Insider profile, otherwise Early Member. */
export type WelcomePath = 'early' | 'insider';
