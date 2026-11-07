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


STREAM_FIXTURE = """
browser.runtime.onConnect.addListener(port => {
  if (port.name !== "echo-smoke-fixture") return;
  port.onMessage.addListener(fixture => {
    messages = fixture.messages;
    busy = fixture.busy;
    if (fixture.account) account = fixture.account;
    if (fixture.models) models = fixture.models;
    if (fixture.model) model = fixture.model;
    activity = fixture.busy ? "Thinking through your question…" : "";
    publish();
    port.postMessage({applied: true});
  });
});
"""


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
                    if file == extension / "background.js":
                        archive.writestr("background.js", file.read_text() + STREAM_FIXTURE)
                    else:
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
                    assert driver.script("return !document.querySelector('.brand, .brand-icon, #page-context, #welcome p');")
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
                    theme_check = driver.call("WebDriver:ExecuteAsyncScript", script="""
                        const done = arguments[arguments.length - 1];
                        const settings = document.querySelector('#theme');
                        const extension = window.wrappedJSObject?.browser ?? window.browser;
                        function select(theme) {
                          settings.value = theme;
                          settings.dispatchEvent(new Event('change'));
                        }
                        (async () => {
                          const initial = settings.value;
                          select('dark');
                          const dark = getComputedStyle(document.documentElement).colorScheme;
                          const saved = (await extension.storage.local.get('theme')).theme;
                          select('light');
                          const light = getComputedStyle(document.documentElement).colorScheme;
                          select('system');
                          done({ initial, dark, saved, light });
                        })().catch(error => done({ error: error.message }));
                    """, args=[])["value"]
                    assert theme_check == {"initial": "system", "dark": "dark", "saved": "dark", "light": "light"}, theme_check
                    stream_check = driver.call("WebDriver:ExecuteAsyncScript", script=r"""
                        const done = arguments[arguments.length - 1];
                        const extension = window.wrappedJSObject?.browser ?? window.browser;
                        const port = extension.runtime.connect({ name: 'echo-smoke-fixture' });
                        const container = document.querySelector('#messages');
                        const prompt = { id: 'prompt', role: 'user', text: 'Factor x² − 1', status: 'complete' };
                        const push = (text, status, ready) => new Promise(resolve => {
                          const observer = new MutationObserver(() => {
                            if (ready()) { observer.disconnect(); resolve(); }
                          });
                          observer.observe(container, { subtree: true, childList: true, characterData: true, attributes: true });
                          const reply = { id: 'reply', role: 'assistant', text, status };
                          port.postMessage({ messages: [prompt, reply], busy: status === 'streaming' });
                        });
                        (async () => {
                          await push('', 'streaming', () => container.children.length === 2);
                          const question = container.children[0];
                          const reply = container.children[1];
                          const partial = String.raw`Use a difference of squares. \(x^`;
                          const inline = String.raw`Use a difference of squares. \(x^2\)`;
                          const unfinished = inline + '\n\n' + String.raw`\[\frac{x`;
                          const complete = inline + '\n\n' + String.raw`\[\frac{x}{2}\]`;
                          await push(partial, 'streaming',
                            () => container.lastElementChild.textContent.includes('difference of squares'));
                          const hidesUnfinishedInline = !reply.textContent.includes(String.raw`\(x^`);
                          await push(unfinished, 'streaming', () => Boolean(reply.querySelector('.katex')));
                          const renderedInline = reply.querySelector('.katex');
                          const hidesUnfinishedDisplay = !reply.textContent.includes(String.raw`\frac{x`);
                          await push(complete, 'streaming', () => Boolean(reply.querySelector('.katex-display .mfrac')));
                          const preservesInline = reply.querySelector('.katex') === renderedInline;
                          const sameDuringStream = container.children[0] === question && container.children[1] === reply;
                          await push(complete, 'complete', () => !reply.querySelector('.copy-reply').hidden);
                          done({ hidesUnfinishedInline, hidesUnfinishedDisplay, preservesInline,
                            sameDuringStream, sameOnFinish: container.children[0] === question && container.children[1] === reply,
                            animation: getComputedStyle(container.lastElementChild).animationName });
                          port.disconnect();
                        })().catch(error => done({ error: error.message }));
                    """, args=[])["value"]
                    assert stream_check == {"hidesUnfinishedInline": True, "hidesUnfinishedDisplay": True,
                                            "preservesInline": True, "sameDuringStream": True,
                                            "sameOnFinish": True, "animation": "none"}, stream_check
                    commands = driver.call("WebDriver:ExecuteAsyncScript", script="""
                        const done = arguments[arguments.length - 1];
                        const extension = window.wrappedJSObject?.browser ?? window.browser;
                        extension.commands.getAll().then(done);
                    """, args=[])["value"]
                    toggle_command = next(command for command in commands if command["name"] == "toggle-echo")
                    assert toggle_command["shortcut"] == "Command+Shift+U", toggle_command

                    # Remove the extra sidebar document in the test tab so the real
                    # sidebar is the only view keeping the conversation open.
                    driver.call("WebDriver:Navigate", url="about:blank")

                    def toggle_with_registered_command(expected_open):
                        driver.call("Marionette:SetContext", value="chrome")
                        # Headless macOS does not dispatch OS accelerators. Exercise
                        # the XUL command attached to Echo's registered shortcut.
                        driver.script("""
                            const keyset = [...document.querySelectorAll('keyset')]
                                .find(element => element.id.startsWith('ext-keyset-id-') && element.id.includes('study-lens'));
                            const key = keyset?.querySelector('key[key="U"][modifiers="accel,shift"]');
                            if (!key) throw Error('Echo shortcut key was not registered');
                            key.dispatchEvent(new Event('command', {bubbles: true}));
                        """)
                        deadline = time.monotonic() + 4
                        while driver.script("return window.SidebarController.currentID === arguments[0];", sidebar) != expected_open:
                            assert time.monotonic() < deadline, "Command+Shift+U did not toggle Echo"
                            time.sleep(.05)

                    toggle_with_registered_command(False)
                    toggle_with_registered_command(True)
                    driver.call("Marionette:SetContext", value="content")
                    driver.call("WebDriver:Navigate", url=page)
                    time.sleep(.2)
                    assert driver.script("return !document.querySelector('#messages').children.length && !document.querySelector('#welcome').hidden;"), "Closing Echo retained the old conversation"
                    print("Echo's registered Command+Shift+U command closes and reopens a fresh conversation.")
                    draft_check = driver.call("WebDriver:ExecuteAsyncScript", script="""
                        const done = arguments[arguments.length - 1];
                        const extension = window.wrappedJSObject?.browser ?? window.browser;
                        const port = extension.runtime.connect({name: 'echo-smoke-fixture'});
                        const draft = 'Can you see this page?';
                        (async () => {
                          const current = await extension.windows.getCurrent();
                          const original = await extension.runtime.sendMessage({type: 'state', windowId: current.id});
                          const form = document.querySelector('#composer');
                          const failed = new MutationObserver(() => {
                            const error = document.querySelector('#context-error');
                            const question = document.querySelector('#question');
                            if (error.hidden || question.disabled || question.value !== draft) return;
                            failed.disconnect();
                            done({ preserved: true, assistantCount: document.querySelectorAll('.message.assistant').length,
                              recovery: !document.querySelector('#context-access').hidden });
                            port.postMessage({messages: [], busy: false, account: original.account,
                              models: original.models, model: original.model});
                            port.disconnect();
                          });
                          failed.observe(document.body, {subtree: true, childList: true, attributes: true});
                          await new Promise(resolve => {
                            port.onMessage.addListener(resolve);
                            port.postMessage({messages: [], busy: false, account: {connected: true},
                              models: [{id: 'fixture', name: 'Fixture'}], model: 'fixture'});
                          });
                          form.hidden = false;
                          document.querySelector('#plan-dialog').close();
                          document.querySelector('#question').value = draft;
                          form.requestSubmit();
                        })().catch(error => done({error: error.message}));
                    """, args=[])["value"]
                    assert draft_check == {"preserved": True, "assistantCount": 0, "recovery": True}, draft_check
                    print("A missing tab image preserves the draft and offers recovery without a model reply.")
                    driver.script("document.querySelector('#new-chat').click();")
                    if options.require_helper:
                        error = driver.script("return document.querySelector('#error-text').textContent;")
                        assert not error, error
                    if options.screenshot:
                        import base64
                        shot = driver.call("WebDriver:TakeScreenshot", full=False, scroll=False)["value"]
                        options.screenshot.write_bytes(base64.b64decode(shot))
                    print("Zen opened Echo. Theme persistence, stable streaming messages, and math rendering passed.")
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
