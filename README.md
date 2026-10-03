# Google SERP Links — инструкция по использованию

Скрипт собирает ссылки из органической выдачи Google по поисковым запросам или готовым адресам страниц поиска. Результат можно посмотреть в терминале или сохранить в файл.

Ссылки идут в порядке выдачи. Повторяющиеся URL внутри одного запроса удаляются: остаётся первое вхождение. В обычном режиме заголовки и описания не сохраняются; для них используйте `--compact`.

## Проектируемый API пагинации

Контракт будущего `loadSerpPages(inputUrl, options)` описан в
[отдельном документе](docs/LOAD_SERP_PAGES.md), включая sequence-диаграмму
взаимодействия с `save-html` и критерии приёмки для UT. Это проект API,
а не доступная реализация.
Существующий `loadSerp` и текущие команды CLI сохраняют своё поведение.
Для будущего API разрешён закрытый список URL-параметров из контракта;
остальные отклоняются на этапе `input` до открытия браузера. URL из адресной
строки может содержать неподдерживаемые параметры; совместимость проверяется
отдельными реальными фикстурами B1.
Для `tbm`, `tbs`, `num`, `lr` дополнительно требуется подтверждённое значение
или семейство из реестра контракта; пока он пуст, явно заданные параметры
отклоняются до запроса. Поддержка одного режима не разрешает другие вертикали.

Целевая архитектура: [Mermaid](docs/architecture/Cls-0.mmd).
Все диаграммы: [diagrams.html](docs/diagrams.html).
Обязательная фикстура B1: [протокол](docs/PAGINATION_FIXTURE_PROTOCOL.md).
Для интерактивного просмотра нужен HTTP-сервер, который отдаёт файлы проекта
и общий компонент по `/mermaid-view/` на том же origin; assets не копируются.

E2E-тесты будущего API покрывают AC-01…AC-17: `npm run test:e2e` из папки
репозитория. Сейчас команда намеренно завершается с ошибкой: `loadSerpPages`
и обязательные успешные B1-фикстуры ещё отсутствуют. Тесты используют общий мок
`save-html/testing`; его подключение отдельно проверяется командой
`npm run test:e2e:harness`, а инъекция в существующие API/CLI — командой
`npm run test:save-html`. Эти проверки требуют обновлённого checkout соседа:
[TESTING_SAVE_HTML.md](TESTING_SAVE_HTML.md). Они вынесены из `npm test`,
который запускает основные регрессионные тесты без зависимости от нового мока.
Подробности и карта покрытия: [E2E_TESTS.md](docs/E2E_TESTS.md).

## Компактный формат для оценки software intent

Для передачи данных классификатору используйте `--compact`. Остальная часть README описывает обычные режимы со списками URL.

Скрипт извлекает факты о выдаче, а классификатор на следующем этапе решает, относится ли запрос к программному обеспечению. Скрипт не вычисляет `is_software` или `software_score` и не вызывает LLM. Для одного результата доступны полный `title`, конечный `url`, непустой `snippet` и `result_type`, если тип можно надёжно распознать. Порядок элементов массива уже задаёт ранжирование, поэтому отдельное поле `position` не добавляется. Повторные URL сохраняются только один раз, по первому вхождению. Путь и параметры целевого URL сохраняются, Google redirect-wrapper раскрывается. Отдельное поле `domain` не нужно.

Обычный режим с `keyword`/`urls`, режим `--details` с `country`/`language`/`num` и список `--urls-only` сохраняют свои существующие форматы. `--compact` возвращает одну минимизированную строку JSON на выдачу. В нём вместо `keyword` используется `query`, а в `results` находятся объекты результатов. Например, обычный вывод и компактный вывод одного запроса:

```json
{"keyword":"photo quality enhancer","urls":["https://example.com/tools/photo-enhancer"]}
```

```powershell
node ./scripts/google-serp-links/serp-links.mjs --compact --country it --lang it "photo quality enhancer"
```

```json
{"query":"photo quality enhancer","shopping_present":true,"results":[{"title":"AI Photo Enhancer","url":"https://example.com/tools/photo-enhancer","snippet":"Enhance image quality online with AI...","result_type":"organic"}]}
```

`shopping_present` и `local_pack_present` относятся ко всей выдаче. Они появляются только при уверенном обнаружении соответствующих блоков; их содержимое не сохраняется. Отсутствующие признаки и необязательные поля результата опускаются: без пустых строк, `null` и пустых массивов. Неизвестный `result_type` не угадывается. Допустимые распознанные типы могут включать `organic`, `video`, `app`, `shopping` и `other`.

`snippet` нормализуется: переносы и повторные пробелы заменяются одним пробелом, пробелы по краям удаляются. Обычный короткий текст сохраняется полностью, необычно длинный ограничивается примерно 250–300 символами без повреждения Unicode. Заголовок не обрезается. В компактный вывод не попадают `country`, `language`, `domain`, HTML, breadcrumbs, изображения, рейтинги, sitelinks, People Also Ask, related searches, реклама и содержимое Shopping или Local Pack. Полный HTML допускается только в отдельном диагностическом файле по явному `--debug-html`; в результатах его нет.

`--limit N` задаёт максимум первых результатов, от 1 до 100; по умолчанию 10. Если `--num` не задан явно, скрипт также запрашивает у Google `N` результатов. При одновременном использовании `--num` управляет запросом к Google, а `--limit` ограничивает вывод. Для готового URL выдачи параметры поиска остаются из URL, а `--limit` только ограничивает вывод. `--urls-only` продолжает выводить только URL, даже вместе с `--compact`. Для нескольких запросов `--compact` выводит JSONL: одна SERP на строку, без внешнего массива и pretty-printing. Пример:

```jsonl
{"query":"photo quality enhancer","results":[{"title":"AI Photo Enhancer","url":"https://example.com/tools/photo-enhancer","snippet":"Enhance image quality online with AI...","result_type":"organic"}]}
{"query":"buy camera","shopping_present":true,"results":[{"title":"Camera shop","url":"https://example.org/cameras","result_type":"organic"}]}
{"query":"photo studio near me","local_pack_present":true,"results":[{"title":"Studio directory","url":"https://example.net/studios","result_type":"organic"}]}
```

Проверить контракт можно командой `node --test tests/intent-contract.test.mjs` из папки репозитория.

## 1. Подготовка

Парсер Google и загрузчик HTML находятся в двух соседних Git-репозиториях: `scripts/google-serp-links` и `scripts/save-html`. При клонировании или переносе сохраняйте эти имена и расположение: парсер импортирует модуль соседнего загрузчика. Репозитории не являются Git-подмодулями; у каждого своя история и коммиты, а у общей папки проекта нет Git-репозитория. Инструкция загрузчика находится в `scripts/save-html/README.md`.

Понадобятся Node.js с npm и установленный Google Chrome. В настройках проекта указано требование Node.js 20 или новее; используйте актуальную LTS-версию. Вместо Chrome можно выбрать установленный Microsoft Edge.

Все команды ниже предназначены для PowerShell и выполняются **из общей папки проекта**, где находится папка `scripts` с обоими репозиториями:

```powershell
Set-Location 'D:\work\projects developement\seo texts developement'
```

Один раз установите зависимости:

```powershell
npm --prefix ./scripts/google-serp-links install
npm --prefix ./scripts/save-html install
```

Для установки точных версий из lock-файлов используйте `ci` вместо `install`.

`serp-links.mjs` и `run.sh` в корне репозитория парсера запускают реализацию в `src/`; тесты находятся в `tests/`, навык — в `skills/google-serp-links/SKILL.md`. Из папки парсера запускайте `node ./serp-links.mjs` или `bash ./run.sh` с теми же параметрами. Относительные пути входных и выходных файлов отсчитываются от текущей папки терминала. Зависимости `node_modules/` и профили браузера исключены из Git.

Проверки обоих репозиториев и их Git-статуса из общей папки проекта:

```powershell
npm --prefix ./scripts/save-html test
npm --prefix ./scripts/save-html run test:browser
npm --prefix ./scripts/google-serp-links test
npm --prefix ./scripts/google-serp-links run test:browser
git -C ./scripts/save-html status
git -C ./scripts/google-serp-links status
```

## 2. Первый запуск

Пример: найти до 10 ссылок по запросу на итальянском языке для Италии.

```powershell
node ./scripts/google-serp-links/serp-links.mjs --country it --lang it "migliorare qualità foto"
```

Скрипт откроет Chrome, загрузит выдачу и напечатает результат в терминале. Если появится CAPTCHA или запрос согласия Google, выполните действие в открытом окне. Скрипт ждёт до 5 минут и продолжает автоматически.

Здесь и далее ссылки в примерах вывода условные, а не результаты реального поиска.

```json
{"keyword":"migliorare qualità foto","urls":["https://example.com/photo","https://example.org/guide"]}
```

- `keyword` — исходный поисковый запрос.
- `urls` — найденные ссылки.

По умолчанию возвращается **до 10 ссылок**. Google может отдать меньше. Скрипт обрабатывает загруженную страницу выдачи и не переходит автоматически на следующие страницы.

Чтобы запросить до 5 ссылок:

```powershell
node ./scripts/google-serp-links/serp-links.mjs --country it --lang it --num 5 "migliorare qualità foto"
```

## 3. Сохранение результата в файл

Добавьте `--output` и имя файла:

```powershell
node ./scripts/google-serp-links/serp-links.mjs --country it --lang it --output results.jsonl "migliorare qualità foto"
```

Файл `results.jsonl` появится в текущей папке PowerShell. Можно указать полный путь; папка назначения должна уже существовать. **Если файл существует, его содержимое будет перезаписано.**

В терминале появится краткая сводка, например:

```text
queries=1 urls=2 errors=0 output=results.jsonl
```

Это означает: обработан 1 запрос, найдено 2 ссылки, запросов с ошибками — 0.

Формат **JSONL** — текстовый файл, где каждая строка содержит отдельный JSON-объект для одного запроса. Файл записывается в UTF-8 после обработки всей пачки, а не пополняется после каждого запроса.

Открыть файл в Блокноте:

```powershell
notepad ./results.jsonl
```

## 4. Варианты вывода

### С параметрами запроса: `--details`

```powershell
node ./scripts/google-serp-links/serp-links.mjs --country it --lang it --details --output results.jsonl "migliorare qualità foto"
```

Строка в файле:

```json
{"keyword":"migliorare qualità foto","country":"it","language":"it","num":10,"results":["https://example.com/photo","https://example.org/guide"]}
```

| Поле | Значение |
| --- | --- |
| `keyword` | Исходный запрос |
| `country` | Код страны из параметра `gl`; `null`, если не задан |
| `language` | Код языка из параметра `hl`; `null`, если не задан |
| `num` | Запрошенный максимум ссылок, а не фактическое количество |
| `results` | Массив найденных URL |

Обратите внимание: с `--details` поле со ссылками называется `results`, без него — `urls`.

### Только ссылки: `--urls-only`

```powershell
node ./scripts/google-serp-links/serp-links.mjs --country it --lang it --urls-only "migliorare qualità foto"
```

Вывод в терминале:

```text
https://example.com/photo
https://example.org/guide
```

Для нескольких запросов ссылки идут подряд, без подписей и разделителей. Этот режим не выводит объекты ошибок; проверяйте код завершения. Для проверки ошибок удобнее обычный JSONL.

`--urls-only` нельзя сочетать с `--output`. Сохранить простой список в текстовый файл можно средствами PowerShell:

```powershell
node ./scripts/google-serp-links/serp-links.mjs --country it --lang it --urls-only "migliorare qualità foto" | Set-Content -Encoding utf8 ./links.txt
```

## 5. Несколько запросов

Для одной страны и языка перечислите запросы в кавычках:

```powershell
node ./scripts/google-serp-links/serp-links.mjs --country it --lang it --output results.jsonl "migliorare qualità foto" "rimuovere sfondo foto"
```

Пример содержимого файла:

```jsonl
{"keyword":"migliorare qualità foto","urls":["https://example.com/photo"]}
{"keyword":"rimuovere sfondo foto","urls":["https://example.org/background"]}
```

### Запросы из текстового файла

Создайте файл `keywords.txt` в UTF-8: один запрос на строку.

```text
migliorare qualità foto
rimuovere sfondo foto
```

Запуск:

```powershell
node ./scripts/google-serp-links/serp-links.mjs --country it --lang it --input-file keywords.txt --output results.jsonl
```

Пустые строки и строки, начинающиеся с `#`, пропускаются. Одинаковые запросы с одинаковыми параметрами выполняются один раз. Порядок результатов соответствует порядку входных запросов после удаления повторов.

### Разные страны и языки в одном файле

Используйте TSV-файл: четыре столбца, разделённые настоящим символом табуляции, **без строки заголовков**:

```text
migliorare qualità foto	it	it	10
تحسين جودة الصورة	eg	ar	5
```

Порядок столбцов: `запрос → страна → язык → максимум ссылок`. Для пустых ячеек страны, языка и количества используются параметры команды; по умолчанию страна и язык не заданы, количество — 10.

```powershell
node ./scripts/google-serp-links/serp-links.mjs --input-file keywords.tsv --details --output results.jsonl
```

## 6. Готовый адрес выдачи Google

Этот раздел описывает существующий CLI. У проектируемого
[`loadSerpPages`](docs/LOAD_SERP_PAGES.md) собственная проверка URL-параметров:
например, вход с `ie`, `gs_lp`, `sclient`, `uact` или `iflsig` пока даёт
`input/unsupported-parameter` без запроса к Google. Поддержка любого URL,
скопированного из браузера, для этого API не заявлена.

Вместо текста запроса можно передать URL страницы поиска. Заключайте его в кавычки:

```powershell
node ./scripts/google-serp-links/serp-links.mjs --details "https://www.google.com/search?q=photo+editor&gl=it&hl=it&num=5"
```

В результате вместо `keyword` будет поле `serp` с исходным URL:

```json
{"serp":"https://www.google.com/search?q=photo+editor&gl=it&hl=it&num=5","country":"it","language":"it","num":5,"results":["https://example.com/editor"]}
```

Для готового URL страна, язык и количество берутся из самого адреса. Флаги `--country`, `--lang` и `--num` его не переопределяют. Если в адресе нет `num`, используется максимум 10. Готовые URL также можно записывать отдельными строками во входной файл.

## 7. Основные параметры

| Параметр | Назначение | По умолчанию |
| --- | --- | --- |
| `--country CC` | Страна поиска, например `it`, `eg`, `tr`; также `--gl` | Не задана |
| `--lang LL` | Язык Google, например `it`, `ar`, `ru`; также `--hl` | Не задан |
| `--num N` | Максимум ссылок, от 1 до 100 | 10 |
| `--limit N` | Максимум результатов в выводе, от 1 до 100; для обычного запроса также задаёт `num`, если `--num` не указан | Не задан |
| `--input-file FILE` | Файл запросов TXT или TSV; `-` для стандартного ввода | Запросы из команды |
| `--output FILE` | Сохранить JSONL в файл | Вывод в терминал |
| `--details` | Добавить параметры запроса; ссылки в поле `results` | Ссылки в поле `urls` |
| `--compact` | Компактные данные выдачи для классификатора: `query`, признаки выдачи и объекты `results` | Выключен |
| `--urls-only` | Вывести только URL по одному на строку | Выключен |
| `--browser-channel msedge` | Использовать установленный Edge | `chrome` |
| `--timeout MS` | Время ожидания готовности страницы в миллисекундах | 30000 — 30 секунд |
| `--manual-timeout MS` | Время на ручное прохождение CAPTCHA или согласие | 300000 — 5 минут |
| `--debug-html FILE` | Сохранить HTML и диагностику для одного запроса | Выключен |
| `--headless` | Запустить браузер без видимого окна; без ожидания ручных действий | Выключен |
| `--http-only` | Загрузить страницу по HTTP без выполнения JavaScript | Выключен |
| `--profile DIR` | Папка отдельного профиля браузера | `scripts/save-html/.browser-profile` |
| `--concurrency N` | Количество одновременно обрабатываемых запросов, от 1 до 8 | 1 |
| `--help` | Показать краткую справку | — |

Дополнительные параметры совместимости: `--interactive` включает видимый браузер; `--transport browser|http|auto` выбирает способ загрузки. Режим `browser` используется по умолчанию, `http` равнозначен `--http-only`, `auto` сначала пробует HTTP, затем браузер при требовании JavaScript или неизвестной разметке. Для обычного использования оставьте настройки по умолчанию.

## 8. CAPTCHA и ошибки

При сообщении `user-action-required` переключитесь в открытое окно браузера и выполните проверку или подтвердите согласие. CAPTCHA не решается автоматически. Не закрывайте окно до завершения обработки.

Cookies сохраняются в отдельном профиле скрипта. Не запускайте несколько процессов с одной папкой профиля одновременно; при необходимости задайте каждому свой `--profile`.

При ошибке конкретного запроса в JSONL будет объект с полем `error`, например:

```json
{"keyword":"migliorare qualità foto","error":"google-blocked"}
```

В одной пачке могут быть и успешные результаты, и ошибки. Ошибка не означает, что по запросу нет ссылок.

| Сообщение | Что делать |
| --- | --- |
| `google-blocked` | Google показал CAPTCHA или блокировку. Выполните ручную проверку в видимом браузере; если время истекло, повторите запуск позже. |
| `google-consent` | Подтвердите согласие Google в открытом окне. |
| `captcha-repeated` | CAPTCHA появилась повторно. Обработка этой браузерной сессии прекращается; повторите запуск позже. |
| `captcha-repeated-session-stopped` | Запрос не выполнен из-за повторной CAPTCHA ранее в этой сессии. |
| `google-browser-timeout` | Страница не стала готова вовремя. Проверьте соединение или увеличьте `--timeout`, например до `60000`. |
| `browser-page-closed` | Окно или вкладка были закрыты. Запустите команду снова и оставьте браузер открытым. |
| `google-javascript-required` | При HTTP-загрузке Google потребовал JavaScript. Запустите с обычными настройками браузера. |
| `google-unrecognized-page` | Скрипт не распознал страницу. Сохраните диагностику по примеру ниже. |
| `--debug-html-requires-one-query` | Оставьте ровно один запрос для сохранения диагностики. |
| `--urls-only-cannot-be-combined-with---output` | Выберите JSONL через `--output` или список ссылок через `--urls-only`. |

Если команда `node` или `npm` не найдена, установите Node.js с npm и заново откройте PowerShell. Если Chrome не установлен, установите его либо добавьте `--browser-channel msedge` при наличии Edge.

Пустой массив `urls: []` или `results: []` возвращается при распознанной странице без результатов. Сейчас распознаются некоторые сообщения Google на английском и арабском; другие пустые страницы могут дать `google-unrecognized-page`.

### Как сохранить диагностику

Запустите один проблемный запрос:

```powershell
node ./scripts/google-serp-links/serp-links.mjs --country it --lang it --debug-html google-debug.html --output results.jsonl "migliorare qualità foto"
```

Если страница загрузилась и дошла до сохранения, появятся:

- `google-debug.html` — HTML страницы после выполнения JavaScript;
- `google-debug.html.json` — сведения о странице, HTTP-статусе и признаках блокировки;
- `results.jsonl` — ссылки или ошибка запроса.

При сбое запуска браузера HTML может не появиться. Подробности диагностики и тестов описаны в [DEBUGGING.md](DEBUGGING.md).

### Как проверить успешность запуска

Сразу после команды в PowerShell выполните:

```powershell
$LASTEXITCODE
```

- `0` — обработка завершилась без ошибок запросов.
- `1` — есть ошибка запроса или другая ошибка выполнения; проверьте JSONL и сообщения терминала.
- `2` — неверные параметры команды или не переданы запросы.

Диагностические сообщения идут отдельно от основного результата. При `--output` результаты находятся в файле, а терминал показывает сводку и сообщения о ходе работы.
