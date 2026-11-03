"""The one build step pyproject.toml can't say: the dashboard's page, built from frontend/ into ag_dashboard/static/
(ag_dashboard/page_build.py) when a wheel is built from a checkout (`pip install .`, `pip install git+...`), so the
wheel carries it. With no Node to build it, the wheel goes without it: ag alone needs no Node. An editable install
(`pip install -e .`) builds nothing: the dashboard builds its page when it first starts. From an sdist (PyPI's) it
comes built, and nothing runs."""

import importlib.util
import os

from setuptools import Command, setup
from setuptools.command.build import build
from setuptools.errors import SetupError


def _page_build():
    """ag_dashboard/page_build.py, loaded by its path: nothing is installed yet."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ag_dashboard", "page_build.py")
    spec = importlib.util.spec_from_file_location("_ag_page_build", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class BuildPage(Command):
    description = "build the dashboard's page (frontend/ into ag_dashboard/static/), in a checkout"
    user_options = []

    def initialize_options(self):
        self.editable_mode = False                   # set by an editable install: the dashboard builds it, from here

    def finalize_options(self):
        pass

    def run(self):
        page = _page_build()
        if self.editable_mode or not page.checkout() or not page.wrong():
            return
        try:
            page.build()
        except page.NoTools as exc:
            self.warn(f"the wheel goes without the dashboard's page: {exc}")
        except page.BuildError as exc:
            raise SetupError(str(exc)) from None

    # what an editable install asks of each build step: this one makes files in the source, nothing to map
    def get_outputs(self):
        return []

    def get_output_mapping(self):
        return {}

    def get_source_files(self):
        return []


class Build(build):
    sub_commands = [("build_page", None)] + build.sub_commands   # first: build_py then copies static/ into a wheel


setup(cmdclass={"build": Build, "build_page": BuildPage})
