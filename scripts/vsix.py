"""Build and optionally install a local VSIX using the Python standard library."""

import argparse
import json
from pathlib import Path
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zipfile


ROOT = Path(__file__).resolve().parent.parent
VSIX_NAMESPACE = "http://schemas.microsoft.com/developer/vsx-schema/2011"
TYPES_NAMESPACE = "http://schemas.openxmlformats.org/package/2006/content-types"


def package(target):
    manifest = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    package_manifest = ET.Element(
        "PackageManifest", {"Version": "2.0.0", "xmlns": VSIX_NAMESPACE}
    )
    metadata = ET.SubElement(package_manifest, "Metadata")
    ET.SubElement(
        metadata,
        "Identity",
        {
            "Language": "en-US",
            "Id": manifest["name"],
            "Version": manifest["version"],
            "Publisher": manifest["publisher"],
        },
    )
    ET.SubElement(metadata, "DisplayName").text = manifest["displayName"]
    ET.SubElement(metadata, "Description").text = manifest["description"]
    ET.SubElement(metadata, "Categories").text = ",".join(manifest["categories"])
    properties = ET.SubElement(metadata, "Properties")
    ET.SubElement(
        properties,
        "Property",
        {"Id": "Microsoft.VisualStudio.Code.Engine", "Value": manifest["engines"]["vscode"]},
    )
    ET.SubElement(
        properties,
        "Property",
        {"Id": "Microsoft.VisualStudio.Code.ExtensionKind", "Value": "workspace"},
    )
    installation = ET.SubElement(package_manifest, "Installation")
    ET.SubElement(installation, "InstallationTarget", {"Id": "Microsoft.VisualStudio.Code"})
    ET.SubElement(package_manifest, "Dependencies")
    assets = ET.SubElement(package_manifest, "Assets")
    ET.SubElement(
        assets,
        "Asset",
        {
            "Type": "Microsoft.VisualStudio.Code.Manifest",
            "Path": "extension/package.json",
            "Addressable": "true",
        },
    )

    content_types = ET.Element("Types", {"xmlns": TYPES_NAMESPACE})
    for extension, content_type in {
        "cjs": "application/javascript",
        "json": "application/json",
        "md": "text/markdown",
        "svg": "image/svg+xml",
        "vsixmanifest": "text/xml",
    }.items():
        ET.SubElement(
            content_types, "Default", {"Extension": extension, "ContentType": content_type}
        )

    runtime_files = [
        "package.json",
        "README.md",
        "extension.cjs",
        "cli.cjs",
        "scanner.cjs",
        *sorted(str(file.relative_to(ROOT).as_posix()) for file in (ROOT / "media").glob("*.svg")),
        *sorted(
            str(file.relative_to(ROOT).as_posix())
            for file in (ROOT / "rules").rglob("*")
            if file.is_file()
        ),
    ]
    target.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "extension.vsixmanifest", ET.tostring(package_manifest, encoding="utf-8", xml_declaration=True)
        )
        archive.writestr(
            "[Content_Types].xml", ET.tostring(content_types, encoding="utf-8", xml_declaration=True)
        )
        for name in runtime_files:
            archive.write(ROOT / name, f"extension/{name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    build = commands.add_parser("package", help="write a VSIX file")
    build.add_argument("output", type=Path)
    install = commands.add_parser("install", help="build and install a temporary VSIX")
    install.add_argument("--code", default="code", help="path to the VS Code CLI")
    install.add_argument("--profile", help="VS Code profile to install into")
    args = parser.parse_args()

    if args.command == "package":
        package(args.output)
        print(args.output)
        return

    with tempfile.TemporaryDirectory(prefix="rule-lens-") as temporary:
        target = Path(temporary) / "rule-lens.vsix"
        package(target)
        command = [args.code, "--install-extension", str(target), "--force", "--do-not-sync"]
        if args.profile:
            command.extend(["--profile", args.profile])
        try:
            subprocess.run(command, check=True)
        except FileNotFoundError:
            parser.exit(1, f"Cannot find the VS Code CLI: {args.code}\n")
        except subprocess.CalledProcessError as error:
            parser.exit(error.returncode)


if __name__ == "__main__":
    main()
