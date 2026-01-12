import './style.css';
import { GameApp } from './app/GameApp';

const appRoot = document.querySelector<HTMLElement>('#app');
if (!appRoot) {
  throw new Error('Missing #app root element.');
}

const game = new GameApp(appRoot);
void game.init();
