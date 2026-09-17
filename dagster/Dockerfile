# Host-process image (Dagster webserver + daemon) published by Dagster Labs.
# dagster-celery-k8s is the maintained "host process" build with a `latest` tag;
# it ships dagster + dagster-webserver + dagster daemon executables.
FROM dagster/dagster-celery-k8s:latest

WORKDIR /workspace

# Layer the dependency install so dagster module caches stay warm across edits.
COPY requirements.txt /workspace/requirements.txt
RUN pip install --no-cache-dir -r /workspace/requirements.txt

# Instance config lands in a fresh dagster-home volume on first boot.
COPY dagster.yaml /opt/dagster/dagster_home/dagster.yaml