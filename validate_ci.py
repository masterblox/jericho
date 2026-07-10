import yaml, json
with open("/opt/data/repos/architect-ai/.github/workflows/ci.yml") as f:
    data = yaml.safe_load(f)
jobs = list(data.get("jobs", {}).keys())
steps = [s.get("run","") for s in data["jobs"]["build"]["steps"] if "run" in s]
test_unit = any("test:unit" in s for s in steps)
print(json.dumps({"jobs": jobs, "steps": steps, "test_unit_present": test_unit, "yaml_valid": True}))
