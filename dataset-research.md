Here are **high-signal, actually usable open datasets** for both **phishing** and **prompt injection / LLM attacks**. I’ve filtered out fluff and focused on datasets you can directly plug into models or eval pipelines.

---

# 1) Phishing datasets (emails, URLs, webpages)

## Core email + text phishing corpora

* **Nazario Phishing Corpus**

  * ~9.5k phishing emails
  * Classic benchmark dataset
  * Included in multiple aggregate datasets ([GitHub][1])

* **Enron Email Dataset**

  * ~500k benign emails
  * Use as negative class baseline
  * Commonly paired with phishing corpora ([GitHub][1])

* **SpamAssassin Public Corpus**

  * ~9k emails (spam + ham)
  * Still widely used for ML baselines ([GitHub][1])

* **TREC 2007 Spam Corpus**

  * ~75k emails (mixed)
  * Better class balance than Enron ([GitHub][1])

---

## More modern / structured phishing datasets

* **DataPhish (PhishingSpamDataset)**

  * Multi-source dataset with:

    * phishing / spam / legit labels
    * emotional manipulation annotations
    * attacker intent labels
  * Includes **LLM-generated phishing variants**
  * Useful for adversarial robustness work ([arXiv][2])

* **EPVME Dataset (GitHub)**

  * ~49k malicious emails
  * Includes **header manipulation attacks** (SPF/DMARC bypass, XSS payloads)
  * Good for **structured feature learning** (headers + body) ([GitHub][1])

---

## Web / screenshot phishing datasets

* **PhishVLM dataset (USENIX 2024)**

  * Inputs: URL + webpage screenshots
  * Labels: phishing vs benign + target brand
  * Designed for **vision-language phishing detection** ([GitHub][3])

---

## Aggregated collections

* **Cybersecurity-Datasets repo (curated index)**

  * Links to many phishing + malware + traffic datasets
  * Good starting hub if you want breadth ([GitHub][4])

---

## What’s missing (important)

Most phishing datasets are:

* email-heavy
* outdated (pre-LLM era)
* weak on **multi-modal + social engineering tactics**

The newer ones (DataPhish, PhishVLM) fix this partially.

---

# 2) Prompt injection / LLM attack datasets

This space is much less mature, but there are a few strong ones.

## Large-scale prompt injection datasets

### **Tensor Trust dataset**

* ~126k prompt injection attacks
* ~46k defenses
* Human-generated via adversarial game
* Covers:

  * prompt hijacking
  * prompt extraction
* Best current **realistic attack dataset** ([arXiv][5])

---

### **NotInject dataset (InjecGuard paper)**

* Smaller (~339 samples)
* Focus: **false positives / over-defense**
* Useful for evaluating guardrail models, not training ([arXiv][6])

---

### **CyberLLMInstruct**

* ~55k instruction-response pairs
* Includes:

  * phishing scenarios
  * prompt injection–like adversarial tasks
* Good for **fine-tuning + safety evals** ([arXiv][7])

---

## Emerging / indirect sources

These are not clean datasets, but useful:

* **OpenClaw / agent skill scraping (community research)**

  * ~15% of agent skills contained malicious instructions
  * Includes patterns like:

    * data exfiltration prompts
    * hidden payloads
  * Can be mined into a dataset ([Reddit][8])

---

* **Prompt injection incidents (CI/CD, Copilot, etc.)**

  * Real-world exploits via:

    * GitHub issues
    * CI pipelines
  * Key pattern: *untrusted input → prompt → tool execution* ([cryptika.com][9])

---

# 3) Gaps (this is where opportunity is)

If you’re building something serious (which you likely are), current datasets are insufficient:

### Missing today:

1. **Tool-augmented prompt injection datasets**

   * attacks that trigger:

     * file access
     * API calls
     * browser actions

2. **Long-horizon attacks**

   * multi-step jailbreaks across sessions

3. **Cross-modal injections**

   * HTML / Markdown / images / PDFs

4. **Agent-specific attacks**

   * memory poisoning
   * skill/tool injection
   * retrieval poisoning

---

# 4) What I would actually use (practical stack)

If you want a strong baseline:

### Phishing

* DataPhish (modern, labeled)
* EPVME (structured attacks)
* Enron (negative baseline)

### Prompt injection

* Tensor Trust (core dataset)
* CyberLLMInstruct (instruction tuning)
* * your own synthetic generation

---

# 5) Brutal reality

* Prompt injection datasets are **2–3 years behind reality**
* Most “benchmarks” are:

  * toy attacks
  * static strings
* Real attacks today are:

  * contextual
  * tool-aware
  * multi-step

If you rely only on public datasets, you will overfit to weak threats.

---

[1]: https://github.com/sunknighteric/EPVME-Dataset/?utm_source=chatgpt.com "sunknighteric/EPVME-Dataset: A new malicious email ..."
[2]: https://arxiv.org/html/2511.21448v1?utm_source=chatgpt.com "a Labeled Email Dataset for Text-Based Phishing and ..."
[3]: https://github.com/code-philia/PhishVLM?utm_source=chatgpt.com "code-philia/PhishVLM"
[4]: https://github.com/trenton3983/Cybersecurity-Datasets?utm_source=chatgpt.com "trenton3983/Cybersecurity-Datasets: A curated collection ..."
[5]: https://arxiv.org/abs/2311.01011?utm_source=chatgpt.com "Tensor Trust: Interpretable Prompt Injection Attacks from an Online Game"
[6]: https://arxiv.org/abs/2410.22770?utm_source=chatgpt.com "InjecGuard: Benchmarking and Mitigating Over-defense in Prompt Injection Guardrail Models"
[7]: https://arxiv.org/abs/2503.09334?utm_source=chatgpt.com "CyberLLMInstruct: A New Dataset for Analysing Safety of Fine-Tuned LLMs Using Cyber Security Data"
[8]: https://www.reddit.com/r/MachineLearning/comments/1r30nzv/d_we_scanned_18000_exposed_openclaw_instances_and/?utm_source=chatgpt.com "[D] We scanned 18000 exposed OpenClaw instances and ..."
[9]: https://www.cryptika.com/prompt-injection-flaw-in-github-actions-hits-fortune-500-firms/?utm_source=chatgpt.com "Prompt Injection Flaw in GitHub Actions Hits Fortune 500 ..."
