"use client";

export default function TermsPage() {
  const effectiveDate = "July 2025";

  const sections = [
    {
      id: "about",
      title: "About TennisMate",
      body: (
        <>
          <p>
            Welcome to TennisMate! By accessing or using our website or app, you agree to be
            bound by these Terms and Conditions. If you do not agree, please do not use the
            service.
          </p>
          <p>
            TennisMate is a platform that connects tennis players based on skill level,
            availability, and location to arrange matches and communicate.
          </p>
        </>
      ),
    },
    {
      id: "eligibility",
      title: "Eligibility",
      body: (
        <ul className="list-disc pl-5 space-y-1">
          <li>You must be at least 16 years old to use TennisMate.</li>
          <li>By signing up, you confirm you meet this requirement.</li>
        </ul>
      ),
    },
    {
      id: "account",
      title: "Account and Use",
      body: (
        <ul className="list-disc pl-5 space-y-1">
          <li>You are responsible for activity on your account.</li>
          <li>Do not share your login credentials.</li>
          <li>
            We reserve the right to suspend or delete accounts that violate our terms or act
            inappropriately.
          </li>
        </ul>
      ),
    },
    {
      id: "conduct",
      title: "User Conduct",
      body: (
        <ul className="list-disc pl-5 space-y-1">
          <li>Treat others respectfully.</li>
          <li>Use the app for its intended purpose.</li>
          <li>Avoid offensive or inappropriate language in chats.</li>
          <li>
            TennisMate is not responsible for users’ conduct on or off the platform.
          </li>
        </ul>
      ),
    },
    {
      id: "match-chat",
      title: "Match and Chat Features",
      body: (
        <ul className="list-disc pl-5 space-y-1">
          <li>We do not guarantee match availability or outcomes.</li>
          <li>
            Use of the chat feature must comply with respectful behaviour and privacy
            expectations.
          </li>
        </ul>
      ),
    },
    {
      id: "data",
      title: "Data",
      body: (
        <p>
          You agree to TennisMate storing your profile data, match history, and chat activity
          to deliver core services. See our{" "}
          <a href="/privacy" className="text-emerald-700 underline">
            Privacy Policy
          </a>{" "}
          for more.
        </p>
      ),
    },
    {
      id: "ip",
      title: "Intellectual Property",
      body: (
        <p>
          All content and branding associated with TennisMate is owned by TennisMate and may
          not be copied or redistributed without permission.
        </p>
      ),
    },
    {
      id: "liability",
      title: "Limitation of Liability",
      body: (
        <p>
          TennisMate is an MVP and provided on an “as is” basis. We do not guarantee
          uninterrupted access or error-free operation. We are not liable for any injuries or
          disputes arising from use of the app or matches arranged.
        </p>
      ),
    },
    {
      id: "changes",
      title: "Changes to Terms",
      body: (
        <p>
          We may update these Terms from time to time. Continued use of the app implies
          acceptance of any changes.
        </p>
      ),
    },
  ];

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6 pb-28 text-gray-800">
      {/* Header */}
      <header className="mb-4 sm:mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
          Terms and Conditions
        </h1>
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
