# Общий мок save-html для API и CLI

`loadSerp(url, { saveHtml })` и `runCli(args, { saveHtml })` принимают объект
настоящего `save-html` или сценарный мок. Без передачи зависимости загрузка
работает как раньше. Мок не использует сеть и Chrome; HTML и диагностика
по умолчанию записываются на диск.

## Требования к соседнему репозиторию

`save-html` — отдельный Git-репозиторий в `../save-html`. Его проверенная
закоммиченная ревизия `6b689b582611dbbac9b0c54b9ed9b4888917fd91` экспортирует
`createBrowserLoader`, `fetchHtml` и `renderHtml`, необходимые production-коду
и основным регрессионным тестам, но не содержит `testing/index.mjs` и
`createSaveHtml`.

Для `npm run test:save-html`, `npm run test:e2e:harness` и `npm run test:e2e`
нужен обновлённый checkout соседа с общим тестовым модулем, экспортирующим
`createSaveHtmlMock` и `captureCli`. Текущее обновление соседа также добавляет
фабрику `createSaveHtml` в `save-html.mjs`.
На момент добавления тестов эти изменения соседа ещё не закоммичены;
воспроизводимой ревизии для них пока нет. После их коммита здесь нужно указать
его SHA. Эти команды не входят в `npm test`, чтобы основной набор не зависел
от незакоммиченного мока. Тестовый модуль не копируется в этот репозиторий.

```js
import { createSaveHtmlMock } from '../save-html/testing/index.mjs';
import { loadSerp } from './src/serp-source.mjs';

const html = '<a href="https://example.org/"><h3>Example</h3></a>';
const mock = createSaveHtmlMock({ calls: [{ method: 'renderHtml', html }] });
const results = await loadSerp('https://www.google.com/search?q=test', { saveHtml: mock });
mock.assertDone();
```

```js
import { createSaveHtmlMock } from '../save-html/testing/index.mjs';
import { runCli } from './src/serp-links.mjs';

const mock = createSaveHtmlMock({ calls: [
    { method: 'createBrowserLoader' },
    { method: 'fetchHtml', html: '<a href="https://example.org/"><h3>Example</h3></a>' },
    { method: 'browser.close' }
] });
const code = await runCli(['--http-only', 'test'], {
    saveHtml: mock, setExitCode() {}
});
mock.assertDone();
```

CLI возвращает код завершения и по умолчанию устанавливает `process.exitCode`.
Он принимает также `stdout`/`stderr` с методом `write`, асинхронно итерируемый
`stdin` и `setExitCode(code)` для тестов без изменения глобального состояния.
Справка и ошибки аргументов возвращают код вместо `process.exit`.
Загрузчик принадлежит CLI и закрывается в `finally`; при HTTP-режиме фабрика
создаёт только объект загрузчика, настоящая сессия Chrome не запускается.

Схема сценария и дополнительные примеры: [save-html README](../save-html/README.md).
Проверка подключения: `npm run test:save-html`
(`node --test tests/save-html-injection.integration.mjs`).

Успешный CLI возвращает 0, сохраняя ранее установленный ненулевой process.exitCode.
Для общего перехвата вывода используйте captureCli({ saveHtml: mock }) из save-html/testing;
он возвращает { capture, options } с stdout, stderr и exitCodes в capture.
