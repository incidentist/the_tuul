import sys
from pathlib import Path

# Add the api directory to the sys.path
root_dir = Path(__file__).resolve().parent.parent / "api"
sys.path.append(str(root_dir))
