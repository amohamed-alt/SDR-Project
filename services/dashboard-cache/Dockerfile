FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=8000
WORKDIR /app

RUN useradd --create-home --uid 1001 appuser \
    && mkdir -p /data \
    && chown -R appuser:appuser /data /app

COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=appuser:appuser app.py ./app.py
COPY --chown=appuser:appuser extended_app.py ./extended_app.py
USER appuser

EXPOSE 8000
CMD ["uvicorn", "extended_app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log"]
