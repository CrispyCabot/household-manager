import { registerBoardTypeUi } from '../registry.js';
import { LinkBoardPage } from './LinkBoardPage.js';
import { LinkCard } from './LinkCard.js';

registerBoardTypeUi('link', { Card: LinkCard, Page: LinkBoardPage });
