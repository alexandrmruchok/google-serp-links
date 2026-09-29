# Google SERP Links — инструкция по использованию

Скрипт собирает ссылки из органической выдачи Google по поисковым запросам или готовым адресам страниц поиска. Результат можно посмотреть в терминале или сохранить в файл.

Ссылки идут в порядке выдачи. Повторяющиеся URL внутри одного запроса удаляются: остаётся первое вхождение. Заголовки страниц, описания и позиции отдельными полями не сохраняются.

## 1. Подготовка

Проект состоит из двух Git-репозиториев. Загрузчик `save-html` должен находиться в `scripts/save-html` относительно корня репозитория парсера. После клонирования парсера разместите загрузчик отдельно; структура описана в [README проекта](../README.md).

Понадобятся Node.js с npm и установленный Google Chrome. В настройках проекта указано требование Node.js 20 или новее; используйте актуальную LTS-версию. Вместо Chrome можно выбрать установленный Microsoft Edge.

Все команды ниже предназначены для PowerShell и выполняются **из корня проекта**, где находятся папки `google-serp-links` и `scripts`:

```powershell
Set-Location 'D:\work\projects developement\seo texts developement'
```

Один раз установите зависимости:

```powershell
npm --prefix ./google-serp-links install
npm --prefix ./scripts/save-html install
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
| `--input-file FILE` | Файл запросов TXT или TSV; `-` для стандартного ввода | Запросы из команды |
| `--output FILE` | Сохранить JSONL в файл | Вывод в терминал |
| `--details` | Добавить параметры запроса; ссылки в поле `results` | Ссылки в поле `urls` |
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
