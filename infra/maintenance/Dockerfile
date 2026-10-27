FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONPATH=/app
WORKDIR /app
RUN pip install --no-cache-dir httpx==0.28.1 selectolax==1.0.2 pydantic==2.14.1 protego==0.7.0 'psycopg[binary]==3.2.12'
COPY pipeline/yarenler_pipeline /app/yarenler_pipeline
COPY docs/sources/avesis-aybu.md /app/avesis-aybu.md
COPY infra/maintenance/recheck_orcid.py /app/recheck_orcid.py
COPY infra/maintenance/test_recheck.py /app/test_recheck.py
COPY infra/maintenance/retention.py /app/retention.py
CMD ["python","/app/recheck_orcid.py"]
COPY infra/maintenance/openalex_refresh.py /app/openalex_refresh.py
COPY infra/maintenance/profile_refresh.py /app/profile_refresh.py

COPY infra/maintenance/institution_notices.py /app/institution_notices.py

COPY infra/maintenance/network_quality.py /app/network_quality.py

COPY infra/maintenance/trdizin_refresh.py /app/trdizin_refresh.py
