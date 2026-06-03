import Link from 'next/link';

import { ArrowRightIcon, LineChart } from 'lucide-react';

import {
  CtaButton,
  FeatureCard,
  FeatureGrid,
  FeatureShowcase,
  FeatureShowcaseIconContainer,
  Hero,
  Pill,
} from '@kit/ui/marketing';

import { withI18n } from '~/lib/i18n/with-i18n';

function Home() {
  return (
    <div className={'mt-4 flex flex-col space-y-24 py-14'}>
      <div className={'container mx-auto'}>
        <Hero
          pill={
            <Pill label={'EVA IQ'}>
              <span>Ads Manager</span>
            </Pill>
          }
          title={
            <>
              <span>Stop guessing on your Meta ads.</span>
              <span>Know what works—and what to do next.</span>
            </>
          }
          subtitle={
            <span>
              EVA IQ reads your ad results and tells you, in plain English,
              what&apos;s making money, what&apos;s bleeding it, and exactly what
              to do next—then writes your next ads and builds audiences from your
              real buyers. The same system that took one venue from 2.5x to 9x+
              on its ad spend.
            </span>
          }
          cta={<MainCallToActionButton />}
        />
      </div>

      <div className={'container mx-auto'}>
        <div className={'flex flex-col space-y-16 xl:space-y-32 2xl:space-y-36'}>
          <FeatureShowcase
            heading={
              <>
                <b className="font-semibold dark:text-white">
                  Not a button that launches ads. A system that makes them work.
                </b>{' '}
                <span className="text-muted-foreground font-normal">
                  Real numbers, real audiences, and a clear answer to “what do I
                  do next?”
                </span>
              </>
            }
            icon={
              <FeatureShowcaseIconContainer>
                <LineChart className="h-5" />
                <span>Built for owners, not ad nerds</span>
              </FeatureShowcaseIconContainer>
            }
          >
            <FeatureGrid>
              <FeatureCard
                className={'relative col-span-2 overflow-hidden'}
                label={'See what’s actually working'}
                description={`Upload your ad report and get a plain-English grade on every ad—plus a step-by-step plan for exactly what to do this week.`}
              />

              <FeatureCard
                className={'relative col-span-2 w-full overflow-hidden lg:col-span-1'}
                label={'Audiences from your real buyers'}
                description={`EVA IQ turns your real customers into lookalike audiences on Meta—the engine behind the biggest winners.`}
              />

              <FeatureCard
                className={'relative col-span-2 overflow-hidden lg:col-span-1'}
                label={'Never break the rules by accident'}
                description={`For housing, jobs, credit, and finance, EVA IQ keeps your ads inside Meta’s strict rules automatically.`}
              />

              <FeatureCard
                className={'relative col-span-2 overflow-hidden'}
                label={'Measured against real revenue'}
                description={`Results tied to actual sales, not vanity metrics—so you always know what your ad spend is really worth.`}
              />
            </FeatureGrid>
          </FeatureShowcase>
        </div>
      </div>
    </div>
  );
}

export default withI18n(Home);

function MainCallToActionButton() {
  return (
    <div className={'flex space-x-4'}>
      <CtaButton>
        <Link href={'/auth/sign-in'}>
          <span className={'flex items-center space-x-0.5'}>
            <span>Sign in</span>
            <ArrowRightIcon
              className={
                'animate-in fade-in slide-in-from-left-8 h-4' +
                ' zoom-in fill-mode-both delay-1000 duration-1000'
              }
            />
          </span>
        </Link>
      </CtaButton>
    </div>
  );
}
