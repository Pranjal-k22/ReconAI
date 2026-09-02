# ReconAI

> **Verification-First AI Finance Controller for Razorpay Merchants**

[![Track](https://img.shields.io/badge/Hackathon%20Track-AI%20Finance%20Controller-blue.svg)](#hackathon-track)
[![Status](https://img.shields.io/badge/Status-Step%201%20Planning%20Complete-green.svg)](#current-development-status)

---

## Overview

**ReconAI** is an AI-assisted financial reconciliation system engineered for e-commerce and digital merchants using Razorpay. It solves the critical problem of multi-way financial discrepancies between **Merchant Orders**, **Payment Gateway Transactions**, and **Bank Settlement Records**.

Unlike naive AI solutions that delegate financial decisions to unpredictable LLM outputs, ReconAI uses a **Verification-First Architecture**:
1. **Deterministic Matching Engine**: Computes exact 3-way matches, calculates candidate confidence scores, and flags anomalies using strict rule-based logic in Node.js.
2. **Financial Safety Gate**: Enforces threshold rules and automatically routes any discrepancy or low-confidence match to human review.
3. **Advisory AI Investigator**: Uses Google Gemini API solely for post-exception investigation to analyze contextual data, summarize root causes, and recommend actionable resolution steps.
4. **Immutable Audit Trail**: Logs every system event, AI summary, and human decision.

---

## Problem Statement

E-commerce merchants lose revenue and incur audit penalties due to payment mismatches, uncollected gateway settlements, unexpected fee deductions, failed refund tracking, and duplicate charges. Manual reconciliation using static spreadsheets is time-consuming, expensive, and error-prone.

---

## Key Features

- **3-Way Deterministic Reconciliation**: Reconciles Merchant Orders, Gateway Receipts, and Bank Settlements.
- **120-Record Benchmark Suite**: Deterministic synthetic dataset featuring 10 distinct anomaly types for transparent evaluation.
- **Ground-Truth Isolation**: Production matching engine operates independently of ground truth data to guarantee uncompromised metrics accuracy.
- **Integer Paise Precision**: All monetary logic operates in integer paise to eliminate floating-point precision loss.
- **Razorpay Sync Adapter**: Seamlessly imports test-mode payments and settlements with graceful offline fallbacks.
- **Advisory AI Root-Cause Analysis**: Powered by Google Gemini API to accelerate exception triage without compromising financial truth.
- **Real-Time Accuracy Metrics**: Displays measured precision, recall, F1 score, auto-reconciliation rate, and financial throughput.

---

## Planned Technology Stack

- **Frontend**: React.js, Vite, JavaScript, Tailwind CSS, Axios, Lucide React, Recharts
- **Backend**: Node.js, Express.js, JavaScript, MongoDB, Mongoose, Zod, Multer
- **AI Engine**: Google Gemini API (`@google/genai`)
- **Payment Adapter**: Razorpay API Test Mode
- **Testing**: Vitest, Supertest

---

## Current Development Status

- **Step 1: Project Analysis, Rules & Architecture Planning** — Completed.
- **Next Step**: Step 2 — Backend Foundation Setup (Express API, MongoDB Schemas, Financial Utilities).
