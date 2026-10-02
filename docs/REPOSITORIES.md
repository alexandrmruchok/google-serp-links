# Структура репозиториев

Парсер Google и загрузчик HTML находятся в двух отдельных соседних репозиториях:

```text
проект/
  scripts/
    save-html/
      .git/
      save-html.mjs
      README.md
    google-serp-links/
      .git/
      serp-links.mjs
      run.sh
      package.json
      README.md
      src/
      tests/
      skills/google-serp-links/SKILL.md
```

У общей папки проекта нет Git-репозитория. В каждом инструменте своя история и свои коммиты. При переносе или клонировании разместите обе папки рядом под именами `google-serp-links` и `save-html`: парсер импортирует модуль соседнего загрузчика. Репозитории не являются Git-подмодулями.

## Из общей папки проекта

```powershell
npm --prefix ./scripts/save-html ci
npm --prefix ./scripts/google-serp-links ci
node ./scripts/google-serp-links/serp-links.mjs --country it --lang it --output results.jsonl "migliorare qualità foto"
```

Проверки:

```powershell
npm --prefix ./scripts/save-html test
npm --prefix ./scripts/save-html run test:browser
npm --prefix ./scripts/google-serp-links test
npm --prefix ./scripts/google-serp-links run test:browser
```

Работа с Git:

```powershell
git -C ./scripts/save-html status
git -C ./scripts/google-serp-links status
```

## Из папки репозитория парсера

```powershell
npm ci
npm --prefix ../save-html ci
node ./serp-links.mjs --country it --lang it "migliorare qualità foto"
npm test
npm run test:browser
git status
```

`serp-links.mjs` и `run.sh` в корне репозитория запускают реализацию в `src/`. Вариант для Bash: `bash ./run.sh --country it --lang it "migliorare qualità foto"`.

Относительные пути входных и выходных файлов отсчитываются от текущей папки терминала. Профиль браузера по умолчанию хранится в репозитории загрузчика, в `.browser-profile/`. Установленные зависимости и профили исключены из Git.

Подробные параметры и примеры вывода: [инструкция парсера](../README.md). Инструкция загрузчика — `../save-html/README.md` относительно корня репозитория парсера.
