"""Load Echo in the actual Zen binary, using a throwaway browser profile."""
import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import zipfile


class Marionette:
    def __init__(self, connection):
        self.connection = connection
        self.reader = connection.makefile("rb")
        self.serial = 0
        self.receive()

    def receive(self):
        size = bytearray()
        while (byte := self.reader.read(1)) != b":":
            if not byte:
                raise EOFError("Zen closed the automation connection")
            size.extend(byte)
        return json.loads(self.reader.read(int(size)))

    def call(self, command, **params):
        self.serial += 1
        body = json.dumps([0, self.serial, command, params]).encode()
        self.connection.sendall(str(len(body)).encode() + b":" + body)
        _, ident, error, value = self.receive()
        if ident != self.serial or error:
            raise RuntimeError(f"{command}: {error}")
        return value

    def script(self, script, *args):
        return self.call("WebDriver:ExecuteScript", script=script, args=args)["value"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--zen", default="/Applications/Zen.app/Contents/MacOS/zen")
    parser.add_argument("--require-helper", action="store_true")
    parser.add_argument("--screenshot", type=Path)
    options = parser.parse_args()
    extension = Path(__file__).resolve().parents[1] / "extension"
    with tempfile.TemporaryDirectory(prefix="studylens-zen-") as directory:
        directory = Path(directory)
        profile = directory / "profile"
        profile.mkdir()
        with socket.socket() as reserve:
            reserve.bind(("127.0.0.1", 0))
            port = reserve.getsockname()[1]
        (profile / "user.js").write_text(f'''
user_pref("marionette.port", {port});
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.startup.page", 0);
user_pref("browser.startup.homepage", "about:blank");
user_pref("browser.aboutwelcome.enabled", false);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("app.update.auto", false);
user_pref("layout.css.prefers-color-scheme.content-override", 1);
''')
        addon = directory / "study-lens.xpi"
        with zipfile.ZipFile(addon, "w", zipfile.ZIP_DEFLATED) as archive:
            for file in extension.rglob("*"):
                if file.is_file():
                    archive.write(file, file.relative_to(extension))
        with (directory / "zen.log").open("wb") as log:
            process = subprocess.Popen([options.zen, "-no-remote", "-headless", "-profile", str(profile), "--marionette", "about:blank"], env={**os.environ, "MOZ_REMOTE_ALLOW_SYSTEM_ACCESS": "1"}, stdout=log, stderr=log)
            try:
                deadline = time.monotonic() + 25
                while True:
                    try:
                        connection = socket.create_connection(("127.0.0.1", port), timeout=4)
                        break
                    except OSError:
                        if process.poll() is not None or time.monotonic() >= deadline:
                            raise RuntimeError((directory / "zen.log").read_text(errors="replace")[-2500:])
                        time.sleep(.25)
                with connection:
                    connection.settimeout(25)
                    driver = Marionette(connection)
                    driver.call("WebDriver:NewSession", capabilities={})
                    driver.call("Addon:Install", path=str(addon), temporary=True)
                    driver.call("Marionette:SetContext", value="chrome")
                    page = driver.script("return WebExtensionPolicy.getByID('study-lens@local').getURL('sidebar.html');")
                    sidebar = driver.script("return Array.from(window.SidebarController.sidebars.entries()).find(x => x[1].title === 'Echo')?.[0];")
                    assert sidebar, "Zen did not register the Echo sidebar"
                    driver.script("return window.SidebarController.show(arguments[0]);", sidebar)
                    assert driver.script("return window.SidebarController.currentID === arguments[0];", sidebar), "Zen could not open the Echo sidebar"
                    driver.call("Marionette:SetContext", value="content")
                    driver.call("WebDriver:Navigate", url=page)
                    time.sleep(1)
                    assert driver.script("return document.title === 'Echo' && Boolean(window.katex);"), "Sidebar assets did not load"
                    assert driver.script("return document.querySelector('h1').textContent === 'What should we work on today?';")
                    assert driver.script("return document.querySelector('.brand-icon').naturalWidth === 360 && !document.querySelector('.brand, #page-context, #welcome p');")
                    assert driver.script("return !!document.querySelector('#capture') && !document.querySelector('#history');")
                    assert driver.script("""
                        const form = document.querySelector('#composer');
                        const wasHidden = form.hidden;
                        form.hidden = false;
                        const button = document.querySelector('#send').getBoundingClientRect();
                        const arrow = document.querySelector('#send svg').getBoundingClientRect();
                        form.hidden = wasHidden;
                        return arrow.width > 0 && Math.abs((arrow.left + arrow.right) - (button.left + button.right)) < 1
                            && Math.abs((arrow.top + arrow.bottom) - (button.top + button.bottom)) < 1;
                    """), "The send arrow was not centered"
                    math_check = driver.call("WebDriver:ExecuteAsyncScript", script=r"""
                        const done = arguments[arguments.length - 1];
                        import('./render.js').then(({ renderText }) => {
                          const reply = document.createElement('div');
                          renderText(reply, 'Given $x^2$, simplify:\n\\[\\frac{\\cos x}{\\sin x}\n=\\cot x\\]\n\n`let n = 1`');
                          done({ equations: reply.querySelectorAll('.katex').length,
                            fraction: Boolean(reply.querySelector('.katex-display .mfrac')),
                            code: reply.querySelector('code')?.textContent });
                        }, error => done({ error: error.message }));
                    """, args=[])["value"]
                    assert math_check == {"equations": 2, "fraction": True, "code": "let n = 1"}, math_check
                    driver.script("document.querySelector('#new-chat').click();")
                    if options.require_helper:
                        error = driver.script("return document.querySelector('#error-text').textContent;")
                        assert not error, error
                    if options.screenshot:
                        import base64
                        shot = driver.call("WebDriver:TakeScreenshot", full=False, scroll=False)["value"]
                        options.screenshot.write_bytes(base64.b64decode(shot))
                    print("Zen loaded the extension and opened its sidebar; the welcome screen, temporary chat, and KaTeX are available.")
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=8)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()


if __name__ == "__main__":
    main()
