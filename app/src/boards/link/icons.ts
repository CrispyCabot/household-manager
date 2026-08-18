import { Calendar, Cloud, FileSpreadsheet, FileText, Globe, Image, Mail, MapPin, Music, ShoppingCart, StickyNote, Video } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { LinkIcon } from '@hhm/shared';

interface LinkIconEntry {
  label: string;
  Icon: LucideIcon;
}

/** The preset a link board's icon picker offers — a curated, fixed set (see LinkIconSchema) rather than the whole icon library, so every household's link boards stay visually consistent. */
export const LINK_ICONS: Record<LinkIcon, LinkIconEntry> = {
  spreadsheet: { label: 'Spreadsheet', Icon: FileSpreadsheet },
  calendar: { label: 'Calendar', Icon: Calendar },
  website: { label: 'Website', Icon: Globe },
  document: { label: 'Document', Icon: FileText },
  photos: { label: 'Photos', Icon: Image },
  video: { label: 'Video', Icon: Video },
  shopping: { label: 'Shopping', Icon: ShoppingCart },
  email: { label: 'Email', Icon: Mail },
  map: { label: 'Map', Icon: MapPin },
  cloud: { label: 'Cloud storage', Icon: Cloud },
  music: { label: 'Music', Icon: Music },
  note: { label: 'Note', Icon: StickyNote },
};

export const LINK_ICON_KEYS = Object.keys(LINK_ICONS) as LinkIcon[];
