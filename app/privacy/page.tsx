"use client";

export default function PrivacyPage() {
  const effectiveDate = "July 2025";

  const sections = [
    {
      id: "overview",
      title: "Overview",
      body: (
        <p>
          We value your privacy. This policy explains what data we collect, how we use it,
          and the choices you have when using TennisMate.
        </p>
      ),
    },
    {
      id: "data-we-collect",
      title: "Data We Collect",
      body: (
        <ul className="list-disc pl-5 space-y-1">
          <li>Name and email address</li>
          <li>Postcode and skill level</li>
          <li>Profile photo and bio</li>
          <li>Availability and match activity</li>
          <li>Chat messages (stored for delivery and record-keeping)</li>
          <li>Technical data (e.g., device, app version, rough usage analytics)</li>
        </ul>
      ),
    },
    {
      id: "how-we-use",
      title: "How We Use Your Data",
      body: (
        <ul className="list-disc pl-5 space-y-1">
          <li>To match you with players based on preferences</li>
          <li>To power your profile and user experience</li>
          <li>To enable communication via chat</li>
          <li>To maintain platform functionality, security, and fraud prevention</li>
        </ul>
      ),
    },
    {
      id: "third-parties",
      title: "Third-Party Services",
      body: (
        <p>
          We use Firebase for authentication, database, storage, and hosting. Your data is
          stored securely in their infrastructure. Providers may process data on our behalf
          in accordance with this policy.
        </p>
      ),
    },
    {
      id: "retention",
      title: "Data Retention",
      body: (
        <p>
          We retain your data while you have an account. If you delete your account or
          request deletion, we delete or anonymise your personal data except where we need
          to retain limited information to meet legal or operational requirements.
        </p>
      ),
    },
    {
      id: "security",
      title: "Security",
      body: (
        <p>
          We take reasonable technical and organisational measures to protect your data.
          However, no online service can guarantee absolute security.
        </p>
      ),
    },
    {
      id: "your-rights",
      title: "Your Rights",
      body: (
        <ul className="list-disc pl-5 space-y-1">
          <li>View and update your profile information</li>
          <li>Request corrections to inaccurate data</li>
          <li>Request deletion of your account and personal data</li>
          <li>
            Ask questions about how your data is used by emailing{" "}
            <a className="text-emerald-700 underline" href="mailto:support@tennis-mate.com.au">
              support@tennis-mate.com.au
            </a>
          </li>
        </ul>
      ),
    },
    {
      id: "children",
      title: "Children’s Privacy",
      body: (
        <p>
          TennisMate is intended for users aged 16 and over. We do not knowingly collect
          personal data from children under 16.
        </p>
      ),
    },
    {
      id: "changes",
      title: "Changes to This Policy",
      body: (
        <p>
          We may update this policy from time to time. If we make material changes, we will
          provide notice in the app. Continued use of the app after changes take effect
          means you accept the revised policy.
        </p>
      ),
    },
    {
      id: "contact",
      title: "Contact Us",
      body: (
        <p>
          For privacy questions or requests, contact us at{" "}
          <a className="text-emerald-700 underline" href="mailto:support@tennis-mate.com.au">
            support@tennis-mate.com.au
          </a>
          . You can also review our{" "}
          <a className="text-emerald-700 underline" href="/terms">
            Terms & Conditions
          </a>
          .
        </p>
      ),
    },
  ];

  return (
    <main id="top" className="mx-auto max-w-3xl p-4 sm:p-6 pb-28 text-gray-800">
      {/* Header */}
      <header className="mb-4 sm:mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="mt-1 text-sm text-gray-600">Effective date: {effectiveDate}</p>
      </header>

      {/* Table of contents */}
      <nav
        aria-label="On this page"
        className="mb-5 rounded-2xl border bg-white p-4 shadow-sm"
      >
        <ul className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {sections.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="inline-block rounded-full border px-3 py-1 text-sm hover:bg-gray-50"
              >
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {/* Content */}
      <article className="space-y-5">
        {sections.map((s) => (
          <section
            key={s.id}
            id={s.id}
            className="rounded-2xl border bg-white p-5 sm:p-6 shadow-sm scroll-mt-24"
          >
            <h2 className="text-lg font-semibold">{s.title}</h2>
            <div className="mt-2 text-[15px] leading-relaxed space-y-3">{s.body}</div>
            <div className="mt-3 text-right">
              <a href="#top" className="text-xs text-gray-500 underline">
                Back to top
              </a>
            </div>
          </section>
        ))}
      </article>

      {/* Utilities */}
      <div className="mt-6">
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
        >
          Print / Save PDF
        </button>
      </div>
    </main>
  );
}
