# Google SERP Links

Сбор органических ссылок из выдачи Google. Подробная инструкция для пользователя: [google-serp-links/README.md](google-serp-links/README.md).

## Два отдельных репозитория

Репозиторий `google-serp-links` находится в корне этого проекта и содержит:

- `google-serp-links/` — парсер, зависимости, тесты и документацию;
- `scripts/google-serp-links/` — команды запуска из корня проекта;
- `skills/google-serp-links/` — инструкцию для подключения навыка.

Загрузчик HTML — отдельный репозиторий `save-html`, расположенный в `scripts/save-html/`. Он исключён из Git парсера и имеет собственную историю коммитов. Это обычный отдельный репозиторий, не Git-подмодуль: при копировании или клонировании проекта его нужно разместить отдельно по этому пути.

```text
google-serp-links/          ← корень репозитория парсера
  .git/
  google-serp-links/
  scripts/
    google-serp-links/
    save-html/             ← корень репозитория загрузчика
      .git/
      save-html.mjs
  skills/
```

Парсер импортирует загрузчик по относительному пути `scripts/save-html/save-html.mjs`. Сохраняйте эту структуру при переносе. Установленные зависимости, профили браузера и результаты запусков не входят в коммиты.

## Установка и запуск

Нужны Node.js с npm и установленный Chrome. После размещения обоих репозиториев выполните из корня парсера:

```powershell
npm --prefix ./scripts/save-html ci
npm --prefix ./google-serp-links ci
node ./scripts/google-serp-links/serp-links.mjs --country it --lang it --output results.jsonl "migliorare qualità foto"
```

Настройки, форматы результата и ошибки описаны в [инструкции парсера](google-serp-links/README.md). Инструкция загрузчика находится в `scripts/save-html/README.md` после размещения второго репозитория.

## Проверки

Из корня проекта:

```powershell
npm --prefix ./scripts/save-html test
npm --prefix ./scripts/save-html run test:browser
npm --prefix ./google-serp-links test
npm --prefix ./google-serp-links run test:browser
```

Браузерные тесты используют установленный Chrome и локальные тестовые страницы.

## Коммиты

Из корня проекта `git status` показывает изменения парсера. Для загрузчика используйте `git -C scripts/save-html status`. Добавляйте файлы и делайте коммиты отдельно в соответствующем репозитории.
