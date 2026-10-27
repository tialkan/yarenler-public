FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 OMP_NUM_THREADS=2 TOKENIZERS_PARALLELISM=false HF_HOME=/models
WORKDIR /app
RUN pip install --no-cache-dir fastembed==0.7.4 fastapi==0.119.1 uvicorn==0.38.0 'psycopg[binary]==3.2.12'
COPY service.py /app/service.py
CMD ["uvicorn","service:app","--host","0.0.0.0","--port","8000","--workers","1"]
