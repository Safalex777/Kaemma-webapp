"""Собирает index.html из app-src.html: вставляет набор иконок Phosphor из sprite.txt."""
import pathlib
d = pathlib.Path(__file__).parent
src = (d / 'app-src.html').read_text()
(d / 'index.html').write_text(src.replace('<!--SPRITE-->', (d / 'sprite.txt').read_text()))
print('index.html собран')
